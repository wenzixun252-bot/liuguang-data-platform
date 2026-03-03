"""ETL 定时任务定义。"""

import logging
from datetime import datetime

from sqlalchemy import select

from app.database import async_session
from app.models.asset import ETLSyncState
from app.models.user import User
from app.services.etl.extractor import RegistryEntry, incremental_extractor, registry_reader
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


async def etl_sync_single_source(app_token: str, table_id: str, owner_id: str | None, asset_type: str = "document") -> None:
    """同步单个数据源。"""
    logger.info("单源同步开始: %s/%s", app_token, table_id)

    async with async_session() as db:
        # 标记 running
        result = await db.execute(
            select(ETLSyncState).where(
                ETLSyncState.source_app_token == app_token,
                ETLSyncState.source_table_id == table_id,
            )
        )
        state = result.scalar_one_or_none()
        if state:
            state.last_sync_status = "running"
            state.error_message = None
        else:
            db.add(ETLSyncState(
                source_app_token=app_token,
                source_table_id=table_id,
                last_sync_status="running",
            ))
        await db.commit()

    try:
        async with async_session() as db:
            user_token = await _resolve_user_token(owner_id, db)

            entry = RegistryEntry(
                app_token=app_token,
                table_id=table_id,
                owner_id=owner_id,
                asset_type=asset_type,
            )

            extraction = await incremental_extractor.extract(entry, db, user_access_token=user_token)

            if not extraction.records and owner_id and user_token:
                refreshed_token = await _try_refresh_token(owner_id, db)
                if refreshed_token and refreshed_token != user_token:
                    extraction = await incremental_extractor.extract(entry, db, user_access_token=refreshed_token)
                    user_token = refreshed_token

            if not extraction.records:
                logger.info("单源同步 %s/%s 无增量数据", app_token, table_id)
                result = await db.execute(
                    select(ETLSyncState).where(
                        ETLSyncState.source_app_token == app_token,
                        ETLSyncState.source_table_id == table_id,
                    )
                )
                state = result.scalar_one_or_none()
                if state:
                    state.last_sync_status = "success"
                    state.last_sync_time = datetime.utcnow()
                    state.error_message = None
                    await db.commit()
                return

            transform_result = await data_transformer.transform(
                extraction, entry.asset_type, db,
                owner_id=owner_id,
            )

            if transform_result.records:
                await asset_loader.load(transform_result, db, user_access_token=user_token)

            logger.info("单源同步 %s/%s 完成", app_token, table_id)

    except Exception as e:
        logger.error("单源同步 %s/%s 失败: %s", app_token, table_id, e, exc_info=True)
        await _mark_failed(app_token, table_id, str(e))


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


async def todo_extract_job() -> None:
    """定时任务：为所有活跃用户自动提取待办（去重）。"""
    from app.models.user import User
    from app.services.todo_extractor import extract_and_save

    logger.info("待办自动提取任务开始")

    async with async_session() as db:
        # 获取所有有 access_token 的活跃用户
        result = await db.execute(
            select(User).where(User.feishu_access_token.isnot(None))
        )
        users = result.scalars().all()

    total_extracted = 0
    for user in users:
        try:
            async with async_session() as db:
                items = await extract_and_save(db, user.feishu_open_id, days=3)
                total_extracted += len(items)
                if items:
                    logger.info("用户 %s 自动提取 %d 条待办", user.name, len(items))
        except Exception as e:
            logger.warning("用户 %s 待办提取失败: %s", user.feishu_open_id, e)

    logger.info("待办自动提取完成，共提取 %d 条", total_extracted)


async def todo_sync_status_job() -> None:
    """定时任务：同步已推送飞书的待办完成状态。"""
    from app.models.todo_item import TodoItem
    from app.services.feishu import feishu_client

    logger.info("飞书任务状态同步开始")

    async with async_session() as db:
        # 查找所有已推送但未完成的待办
        result = await db.execute(
            select(TodoItem).where(
                TodoItem.status == "in_progress",
                TodoItem.feishu_task_id.isnot(None),
            )
        )
        pushed_items = result.scalars().all()

    if not pushed_items:
        logger.info("没有需要同步状态的飞书任务")
        return

    completed_count = 0
    for item in pushed_items:
        try:
            task_data = await feishu_client.get_task_detail(item.feishu_task_id)
            if not task_data:
                continue

            # 飞书任务 v2: completed_at 非空表示已完成
            if task_data.get("completed_at") and task_data["completed_at"] != "0":
                async with async_session() as db:
                    todo = await db.get(TodoItem, item.id)
                    if todo and todo.status == "in_progress":
                        todo.status = "completed"
                        todo.completed_at = datetime.utcnow()
                        await db.commit()
                        completed_count += 1
                        logger.info("待办 #%d 已在飞书完成，状态已同步", item.id)
        except Exception as e:
            logger.warning("同步飞书任务 %s 状态失败: %s", item.feishu_task_id, e)

    logger.info("飞书任务状态同步完成，%d 条已完成", completed_count)


async def kg_build_job() -> None:
    """定时任务：自动增量构建知识图谱。"""
    from app.services.kg_builder import build_knowledge_graph

    logger.info("知识图谱自动构建任务开始")

    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.feishu_access_token.isnot(None))
        )
        users = result.scalars().all()

    total_entities = 0
    total_relations = 0
    for user in users:
        try:
            async with async_session() as db:
                result = await build_knowledge_graph(db, user.feishu_open_id, incremental=True)
                total_entities += result.get("entities_added", 0)
                total_relations += result.get("relations_added", 0)
                if result.get("entities_added", 0) > 0:
                    logger.info(
                        "用户 %s KG构建: +%d 实体, +%d 关系",
                        user.name, result["entities_added"], result["relations_added"],
                    )
        except Exception as e:
            logger.warning("用户 %s KG构建失败: %s", user.feishu_open_id, e)

    logger.info("知识图谱自动构建完成，共新增 %d 实体, %d 关系", total_entities, total_relations)


async def structured_table_sync_job() -> None:
    """定时任务：自动同步所有飞书来源的结构化数据表（多维表格 + 飞书表格）。"""
    from app.models.structured_table import StructuredTable
    from app.services.structured_table_import import sync_table

    logger.info("结构化数据表同步任务开始")

    async with async_session() as db:
        result = await db.execute(
            select(StructuredTable).where(
                StructuredTable.source_type.in_(["bitable", "spreadsheet"]),
            )
        )
        tables = result.scalars().all()

    if not tables:
        logger.info("没有需要同步的结构化数据表")
        return

    synced = 0
    for table in tables:
        try:
            async with async_session() as db:
                # 获取 owner 的 user_access_token
                user_token = await _resolve_user_token(table.owner_id, db)
                if not user_token:
                    user_token = await _try_refresh_token(table.owner_id, db)
                if not user_token:
                    logger.warning("表格 %s (id=%d) 的用户无可用 token，跳过", table.name, table.id)
                    continue

                await sync_table(db, table.id, user_access_token=user_token)
                synced += 1
                logger.info("同步结构化数据表: %s (id=%d)", table.name, table.id)
        except Exception as e:
            logger.warning("同步结构化数据表 %s (id=%d) 失败: %s", table.name, table.id, e)

    logger.info("结构化数据表同步完成，共同步 %d/%d 个表", synced, len(tables))


async def persona_generate_job() -> None:
    """定时任务：自动为没有画像的候选人生成画像。"""
    from app.models.leadership_insight import LeadershipInsight
    from app.services.leadership_analyzer import generate_insight, get_leadership_candidates

    logger.info("人物画像自动生成任务开始")

    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.feishu_access_token.isnot(None))
        )
        users = result.scalars().all()

    total_generated = 0
    for user in users:
        try:
            async with async_session() as db:
                candidates = await get_leadership_candidates(db, user.feishu_open_id)

                # 查询已有画像的候选人名单
                existing_result = await db.execute(
                    select(LeadershipInsight.target_user_name).where(
                        LeadershipInsight.analyst_user_id == user.feishu_open_id,
                    )
                )
                existing_names = {row[0] for row in existing_result.all()}

                # 只对没有画像的候选人生成
                for c in candidates:
                    if c["name"] not in existing_names:
                        try:
                            await generate_insight(
                                db=db,
                                analyst_user_id=user.feishu_open_id,
                                target_user_id=c["name"],
                                target_user_name=c["name"],
                            )
                            total_generated += 1
                            logger.info("自动生成画像: %s (分析者: %s)", c["name"], user.name)
                        except Exception as e:
                            logger.warning("自动生成画像 %s 失败: %s", c["name"], e)
        except Exception as e:
            logger.warning("用户 %s 画像生成任务失败: %s", user.feishu_open_id, e)

    logger.info("人物画像自动生成完成，共生成 %d 条", total_generated)
