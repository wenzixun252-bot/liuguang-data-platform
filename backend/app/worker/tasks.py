"""ETL 定时任务定义。"""

import logging
from datetime import datetime

from sqlalchemy import select

from app.database import async_session
from app.models.asset import ETLSyncState
from app.models.user import User
from app.services.etl.extractor import incremental_extractor, registry_reader
from app.services.etl.loader import asset_loader
from app.services.etl.transformer import data_transformer
from app.services.feishu import FeishuAPIError, feishu_client

logger = logging.getLogger(__name__)


async def _resolve_user_token(owner_id: str | None, db) -> str | None:
    """根据数据源 owner_id 查找用户的 user_access_token。

    直接返回存储的 token，不预先验证（避免多余的 API 调用）。
    如果 token 过期会在实际抽取时失败，由 _try_refresh_and_retry 处理。
    """
    if not owner_id:
        return None

    result = await db.execute(
        select(User).where(User.feishu_open_id == owner_id)
    )
    user = result.scalar_one_or_none()
    if not user or not user.feishu_access_token:
        logger.warning("用户 %s 无可用的 access_token", owner_id)
        return None

    return user.feishu_access_token


async def _try_refresh_token(owner_id: str, db) -> str | None:
    """尝试用 refresh_token 刷新 access_token。"""
    result = await db.execute(
        select(User).where(User.feishu_open_id == owner_id)
    )
    user = result.scalar_one_or_none()
    if not user or not user.feishu_refresh_token:
        logger.warning("用户 %s 无 refresh_token，无法刷新", owner_id)
        return None

    try:
        token_data = await feishu_client.refresh_user_access_token(user.feishu_refresh_token)
        user.feishu_access_token = token_data["access_token"]
        user.feishu_refresh_token = token_data.get("refresh_token", user.feishu_refresh_token)
        await db.commit()
        logger.info("已刷新用户 %s 的 access_token", owner_id)
        return user.feishu_access_token
    except (FeishuAPIError, Exception) as e:
        logger.warning("刷新用户 %s 的 token 失败: %s", owner_id, e)
        return None


async def _mark_failed(app_token: str, table_id: str, error: str) -> None:
    """将同步状态标记为失败。"""
    async with async_session() as db:
        result = await db.execute(
            select(ETLSyncState).where(
                ETLSyncState.source_app_token == app_token,
                ETLSyncState.source_table_id == table_id,
            )
        )
        state = result.scalar_one_or_none()
        if state:
            state.last_sync_status = "failed"
            state.error_message = error[:1000]
            state.last_sync_time = datetime.utcnow()
            await db.commit()


async def etl_sync_job() -> None:
    """定时任务入口：遍历注册中心 → 逐表增量抽取 → Transform → Load。"""
    logger.info("ETL 同步任务开始")

    try:
        entries = await registry_reader.read()
    except Exception as e:
        logger.error("读取数据源列表失败: %s", e)
        return

    if not entries:
        logger.info("数据源为空，跳过本轮同步")
        return

    total_extracted = 0
    total_loaded = 0

    # 先将所有数据源状态标记为 running
    async with async_session() as db:
        for entry in entries:
            result = await db.execute(
                select(ETLSyncState).where(
                    ETLSyncState.source_app_token == entry.app_token,
                    ETLSyncState.source_table_id == entry.table_id,
                )
            )
            state = result.scalar_one_or_none()
            if state:
                state.last_sync_status = "running"
                state.error_message = None
            else:
                db.add(ETLSyncState(
                    source_app_token=entry.app_token,
                    source_table_id=entry.table_id,
                    last_sync_status="running",
                ))
        await db.commit()

    for entry in entries:
        try:
            async with async_session() as db:
                # 获取数据源 owner 的 user_access_token（用户级权限读取多维表格）
                user_token = await _resolve_user_token(entry.owner_id, db)

                # 1. Extract — 增量抽取（如果 token 过期会自动尝试刷新重试）
                extraction = await incremental_extractor.extract(entry, db, user_access_token=user_token)

                # 如果抽取失败且有 owner_id，尝试刷新 token 重试一次
                if not extraction.records and entry.owner_id and user_token:
                    refreshed_token = await _try_refresh_token(entry.owner_id, db)
                    if refreshed_token and refreshed_token != user_token:
                        logger.info("Token 已刷新，重试抽取: %s/%s", entry.app_token, entry.table_id)
                        extraction = await incremental_extractor.extract(entry, db, user_access_token=refreshed_token)

                count = len(extraction.records)
                total_extracted += count

                if not extraction.records:
                    logger.info("数据源 %s/%s 无增量数据", entry.app_token, entry.table_id)
                    result = await db.execute(
                        select(ETLSyncState).where(
                            ETLSyncState.source_app_token == entry.app_token,
                            ETLSyncState.source_table_id == entry.table_id,
                        )
                    )
                    state = result.scalar_one_or_none()
                    if state:
                        state.last_sync_status = "success"
                        state.last_sync_time = datetime.utcnow()
                        state.error_message = None
                        await db.commit()
                    continue

                # 2. Transform — Schema 映射 + 数据清洗（路由到目标表）
                transform_result = await data_transformer.transform(
                    extraction, entry.asset_type, db,
                    owner_id=entry.owner_id,
                )

                if not transform_result.records:
                    logger.info("数据源 %s/%s 转换后无有效记录", entry.app_token, entry.table_id)
                    result = await db.execute(
                        select(ETLSyncState).where(
                            ETLSyncState.source_app_token == entry.app_token,
                            ETLSyncState.source_table_id == entry.table_id,
                        )
                    )
                    state = result.scalar_one_or_none()
                    if state:
                        state.last_sync_status = "success"
                        state.last_sync_time = datetime.utcnow()
                        state.error_message = None
                        await db.commit()
                    continue

                # 3. Load — 附件下载提取 + Embedding + Upsert（按 target_table 路由）
                loaded = await asset_loader.load(transform_result, db, user_access_token=user_token)
                total_loaded += loaded

        except Exception as e:
            logger.error("ETL 同步数据源 %s/%s 失败: %s", entry.app_token, entry.table_id, e, exc_info=True)
            await _mark_failed(entry.app_token, entry.table_id, str(e))

    logger.info(
        "ETL 同步任务完成，共抽取 %d 条, 入库 %d 条",
        total_extracted,
        total_loaded,
    )


async def cloud_folder_sync_job() -> None:
    """定时任务：同步所有启用的云文件夹数据源。"""
    from app.models.asset import CloudFolderSource
    from app.services.cloud_doc_import import cloud_doc_import_service

    logger.info("云文件夹同步任务开始")

    async with async_session() as db:
        result = await db.execute(
            select(CloudFolderSource).where(
                CloudFolderSource.is_enabled == True,  # noqa: E712
            )
        )
        folders = result.scalars().all()

    if not folders:
        logger.info("没有启用的云文件夹源，跳过")
        return

    for folder in folders:
        try:
            async with async_session() as db:
                # 更新状态为 running
                folder_obj = await db.get(CloudFolderSource, folder.id)
                if not folder_obj:
                    continue
                folder_obj.last_sync_status = "running"
                folder_obj.error_message = None
                await db.commit()

                # 获取 owner 的 token
                user_token = await _resolve_user_token(folder.owner_id, db)
                if not user_token:
                    # 尝试刷新
                    user_token = await _try_refresh_token(folder.owner_id, db)
                if not user_token:
                    raise Exception(f"用户 {folder.owner_id} 无可用 token")

                # 查找 uploader_name
                user_result = await db.execute(
                    select(User).where(User.feishu_open_id == folder.owner_id)
                )
                user = user_result.scalar_one_or_none()
                uploader_name = user.name if user else None

                # 执行同步
                sync_result = await cloud_doc_import_service.sync_folder(
                    folder.folder_token,
                    folder.owner_id,
                    db,
                    user_token,
                    uploader_name,
                )

                # 更新成功状态
                folder_obj = await db.get(CloudFolderSource, folder.id)
                if folder_obj:
                    folder_obj.last_sync_status = "success"
                    folder_obj.last_sync_time = datetime.utcnow()
                    folder_obj.files_synced = sync_result.imported + sync_result.skipped
                    folder_obj.error_message = None
                    await db.commit()

                logger.info(
                    "文件夹 %s 同步完成: imported=%d, skipped=%d, failed=%d",
                    folder.folder_name, sync_result.imported,
                    sync_result.skipped, sync_result.failed,
                )

        except Exception as e:
            logger.error("文件夹 %s (%s) 同步失败: %s", folder.folder_name, folder.folder_token, e)
            try:
                async with async_session() as db:
                    folder_obj = await db.get(CloudFolderSource, folder.id)
                    if folder_obj:
                        folder_obj.last_sync_status = "failed"
                        folder_obj.error_message = str(e)[:500]
                        await db.commit()
            except Exception:
                pass

    logger.info("云文件夹同步任务完成")
