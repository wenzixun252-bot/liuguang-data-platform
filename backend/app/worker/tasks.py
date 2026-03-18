"""ETL 定时任务定义。"""

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

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


async def _reset_sync_time_if_target_empty(
    app_token: str, table_id: str, owner_id: str | None, asset_type: str, db,
) -> None:
    """如果目标表中该数据源的记录为 0，则重置 last_sync_time 以强制全量拉取。

    解决场景：用户删除所有沟通/文档记录后重新同步，但 ETLSyncState 仍保留旧的
    last_sync_time，导致增量过滤认为"无新数据"而跳过。
    """
    from sqlalchemy import text as sa_text

    result = await db.execute(
        select(ETLSyncState).where(
            ETLSyncState.source_app_token == app_token,
            ETLSyncState.source_table_id == table_id,
        )
    )
    state = result.scalar_one_or_none()
    if not state or not state.last_sync_time:
        return  # 没有旧状态或从未同步过，不需要重置

    # 判断上次同步时间是否为有意义的值（大于 epoch）
    epoch = datetime(1970, 1, 2)
    if state.last_sync_time <= epoch:
        return  # 已经是初始状态

    # 检查目标表中是否有该数据源的记录
    target_table = "communications" if asset_type in ("communication", "meeting", "chat_message") else "documents"
    if owner_id:
        cnt_result = await db.execute(
            sa_text(
                f"SELECT COUNT(*) FROM {target_table} "
                f"WHERE owner_id = :oid AND source_app_token = :app AND source_table_id = :tid"
            ),
            {"oid": owner_id, "app": app_token, "tid": table_id},
        )
    else:
        cnt_result = await db.execute(
            sa_text(
                f"SELECT COUNT(*) FROM {target_table} "
                f"WHERE source_app_token = :app AND source_table_id = :tid"
            ),
            {"app": app_token, "tid": table_id},
        )
    count = cnt_result.scalar() or 0

    if count == 0:
        logger.warning(
            "目标表 %s 中数据源 %s/%s 记录为 0 但 last_sync_time=%s，重置为全量拉取",
            target_table, app_token, table_id, state.last_sync_time,
        )
        state.last_sync_time = datetime(1970, 1, 1)
        state.records_synced = 0
        await db.commit()


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


async def etl_sync_job(triggered_by: str | None = None) -> None:
    """定时任务入口：遍历注册中心 → 逐表增量抽取 → Transform → Load。"""
    logger.info("ETL 同步任务开始")

    # 清理卡住的同步状态（超过 10 分钟仍为 running 的标记为 failed）
    stale_cutoff = datetime.utcnow() - timedelta(minutes=10)
    try:
        async with async_session() as db:
            stale_result = await db.execute(
                select(ETLSyncState).where(
                    ETLSyncState.last_sync_status == "running",
                    ETLSyncState.updated_at < stale_cutoff,
                )
            )
            stale_count = 0
            for state in stale_result.scalars().all():
                state.last_sync_status = "failed"
                state.error_message = "同步超时，已自动标记为失败"
                state.last_sync_time = datetime.utcnow()
                stale_count += 1
            if stale_count:
                logger.warning("清理了 %d 个卡住的同步状态", stale_count)
            await db.commit()
    except Exception as e:
        logger.error("清理 stale running 状态失败: %s", e)

    try:
        entries = await registry_reader.read()
    except Exception as e:
        logger.error("读取数据源列表失败: %s", e)
        return

    # 结构化数据源由 structured_table_sync_job 单独处理，ETL 管道跳过
    entries = [e for e in entries if e.asset_type != "structured"]

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

                # 检测目标表是否为空，如果为空则重置同步时间强制全量拉取
                await _reset_sync_time_if_target_empty(
                    entry.app_token, entry.table_id, entry.owner_id, entry.asset_type, db,
                )

                # 1. Extract — 增量抽取（如果 token 过期会自动尝试刷新重试）
                extraction = await incremental_extractor.extract(entry, db, user_access_token=user_token)

                # 如果抽取失败且有 owner_id，尝试刷新 token 重试一次
                if not extraction.records and entry.owner_id and user_token:
                    refreshed_token = await _try_refresh_token(entry.owner_id, db)
                    if refreshed_token and refreshed_token != user_token:
                        logger.info("Token 已刷新，重试抽取: %s/%s", entry.app_token, entry.table_id)
                        extraction = await incremental_extractor.extract(entry, db, user_access_token=refreshed_token)
                        user_token = refreshed_token

                # 用户 token 和刷新 token 都失败时，回退到 tenant token
                if not extraction.records and user_token:
                    logger.warning("用户 token 提取失败，回退到 tenant token: %s/%s", entry.app_token, entry.table_id)
                    extraction = await incremental_extractor.extract(entry, db, user_access_token=None)
                    user_token = None

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
                        # 更新实际总记录数
                        if entry.owner_id:
                            try:
                                from sqlalchemy import text
                                if entry.asset_type == "communication":
                                    cnt = await db.execute(
                                        text("SELECT COUNT(*) FROM communications WHERE owner_id = :oid AND source_app_token = :app AND source_table_id = :tid"),
                                        {"oid": entry.owner_id, "app": entry.app_token, "tid": entry.table_id},
                                    )
                                else:
                                    cnt = await db.execute(
                                        text("SELECT COUNT(*) FROM documents WHERE owner_id = :oid AND source_app_token = :app AND source_table_id = :tid"),
                                        {"oid": entry.owner_id, "app": entry.app_token, "tid": entry.table_id},
                                    )
                                state.records_synced = cnt.scalar() or state.records_synced
                            except Exception:
                                await db.rollback()
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


async def etl_sync_single_source(app_token: str, table_id: str, owner_id: str | None, asset_type: str = "document", triggered_by: str | None = None) -> None:
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
        await asyncio.wait_for(_do_single_source_sync(app_token, table_id, owner_id, asset_type, triggered_by=triggered_by), timeout=600)
    except asyncio.TimeoutError:
        logger.error("单源同步 %s/%s 超时 (10分钟)", app_token, table_id)
        await _mark_failed(app_token, table_id, "同步超时 (10分钟)")
    except Exception as e:
        logger.error("单源同步 %s/%s 失败: %s", app_token, table_id, e, exc_info=True)
        await _mark_failed(app_token, table_id, str(e))


async def _do_single_source_sync(app_token: str, table_id: str, owner_id: str | None, asset_type: str, triggered_by: str | None = None) -> None:
    """单源同步的实际执行逻辑（手动触发，全量拉取 + upsert 去重）。"""
    try:
        async with async_session() as db:
            user_token = await _resolve_user_token(owner_id, db)

            entry = RegistryEntry(
                app_token=app_token,
                table_id=table_id,
                owner_id=owner_id,
                asset_type=asset_type,
            )

            # 手动触发的同步一律全量拉取（force_full=True），
            # 靠 loader 的 ON CONFLICT upsert 去重：已有记录更新、新记录插入。
            extraction = await incremental_extractor.extract(
                entry, db, user_access_token=user_token, force_full=True,
            )

            # 用户 token 失败时，尝试刷新 token 重试
            if not extraction.records and owner_id and user_token:
                refreshed_token = await _try_refresh_token(owner_id, db)
                if refreshed_token and refreshed_token != user_token:
                    extraction = await incremental_extractor.extract(
                        entry, db, user_access_token=refreshed_token, force_full=True,
                    )
                    user_token = refreshed_token

            # 用户 token 和刷新 token 都失败时，回退到 tenant token
            if not extraction.records and user_token:
                logger.warning("用户 token 提取失败，回退到 tenant token: %s/%s", app_token, table_id)
                extraction = await incremental_extractor.extract(
                    entry, db, user_access_token=None, force_full=True,
                )
                user_token = None

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
                    # 更新实际总记录数
                    if owner_id:
                        try:
                            from sqlalchemy import text
                            if asset_type == "communication":
                                cnt = await db.execute(
                                    text("SELECT COUNT(*) FROM communications WHERE owner_id = :oid AND source_app_token = :app AND source_table_id = :tid"),
                                    {"oid": owner_id, "app": app_token, "tid": table_id},
                                )
                            else:
                                cnt = await db.execute(
                                    text("SELECT COUNT(*) FROM documents WHERE owner_id = :oid AND source_app_token = :app AND source_table_id = :tid"),
                                    {"oid": owner_id, "app": app_token, "tid": table_id},
                                )
                            state.records_synced = cnt.scalar() or state.records_synced
                        except Exception:
                            await db.rollback()
                    await db.commit()
                return

            transform_result = await data_transformer.transform(
                extraction, entry.asset_type, db,
                owner_id=owner_id,
            )

            if transform_result.records:
                await asset_loader.load(transform_result, db, user_access_token=user_token)
            else:
                # 转换后无有效记录，也要将状态标记为 success
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
                    state.error_message = f"转换后无有效记录 (丢弃 {transform_result.discarded_count} 条)"
                    await db.commit()

            logger.info("单源同步 %s/%s 完成", app_token, table_id)

    except Exception as e:
        logger.error("单源同步执行 %s/%s 失败: %s", app_token, table_id, e, exc_info=True)
        raise


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

                # 执行同步
                sync_result = await cloud_doc_import_service.sync_folder(
                    folder.folder_token,
                    folder.owner_id,
                    db,
                    user_token,
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
    """定时任务：为所有活跃用户自动提取待办（去重），高置信度自动推送飞书。"""
    from app.models.user import User
    from app.services.todo_extractor import extract_and_save, auto_push_high_confidence_todos

    logger.info("待办自动提取任务开始")

    async with async_session() as db:
        # 获取所有有 access_token 的活跃用户
        result = await db.execute(
            select(User).where(User.feishu_access_token.isnot(None))
        )
        users = result.scalars().all()

    total_extracted = 0
    total_pushed = 0
    for user in users:
        try:
            async with async_session() as db:
                items = await extract_and_save(db, user.feishu_open_id, user.name, days=2)
                total_extracted += len(items)
                if items:
                    logger.info("用户 %s 自动提取 %d 条待办", user.name, len(items))
                    pushed = await auto_push_high_confidence_todos(db, items, user.feishu_access_token)
                    total_pushed += pushed
                    if pushed:
                        logger.info("用户 %s 自动推送 %d 条待办到飞书", user.name, pushed)
        except Exception as e:
            logger.warning("用户 %s 待办提取失败: %s", user.feishu_open_id, e)

    logger.info("待办自动提取完成，共提取 %d 条，推送飞书 %d 条", total_extracted, total_pushed)


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
    """定时任务：已禁用自动 KG 构建，仅用户手动触发。"""
    logger.info("KG 自动构建已禁用，请通过知识图谱页面手动触发")
    return


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


async def calendar_reminder_job() -> None:
    """定时任务：检查即将开始的日程，生成 AI 会前简报并通过飞书机器人推送。"""
    import json
    from app.config import settings
    from app.models.calendar_reminder import CalendarReminderPref
    from app.services.feishu import feishu_client, FeishuAPIError
    from app.services.calendar import gather_meeting_context, build_brief_prompt
    from app.services.llm import create_openai_client
    from app.api.deps import get_visible_owner_ids

    logger.info("日程提醒任务开始")

    async with async_session() as db:
        # 查找所有启用提醒的用户
        result = await db.execute(
            select(CalendarReminderPref, User).join(
                User, User.feishu_open_id == CalendarReminderPref.owner_id
            ).where(CalendarReminderPref.enabled == True)
        )
        rows = result.all()

    if not rows:
        logger.info("没有启用日程提醒的用户")
        return

    reminded_count = 0
    for pref, user in rows:
        if not user.feishu_access_token and not user.feishu_refresh_token:
            continue

        try:
            now = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
            # 查找 N 分钟后的事件
            window_start = now + timedelta(minutes=max(0, pref.minutes_before - 5))
            window_end = now + timedelta(minutes=pref.minutes_before + 5)

            # 获取日历事件，token 过期时自动刷新
            access_token = user.feishu_access_token
            events = None
            try:
                if access_token:
                    events = await feishu_client.get_calendar_events(
                        access_token, window_start, window_end,
                    )
            except FeishuAPIError as e:
                err_msg = str(e)
                is_token_error = any(kw in err_msg for kw in ["99991671", "99991668", "99991672", "99991677", "HTTP 401"])
                if not is_token_error:
                    raise
                logger.info("用户 %s 的 access_token 已过期，尝试刷新", user.name)
                access_token = None

            if events is None and user.feishu_refresh_token:
                try:
                    token_data = await feishu_client.refresh_user_access_token(user.feishu_refresh_token)
                    new_token = token_data["access_token"]
                    new_refresh = token_data.get("refresh_token", user.feishu_refresh_token)
                    # 更新数据库中的 token
                    async with async_session() as db:
                        result = await db.execute(
                            select(User).where(User.id == user.id)
                        )
                        u = result.scalar_one_or_none()
                        if u:
                            old_token = u.feishu_access_token
                            u.feishu_access_token = new_token
                            u.feishu_refresh_token = new_refresh
                            await db.commit()
                            if old_token:
                                feishu_client.invalidate_calendar_cache(old_token)
                    access_token = new_token
                    events = await feishu_client.get_calendar_events(
                        access_token, window_start, window_end,
                    )
                    logger.info("用户 %s token 刷新成功，获取到 %d 个事件", user.name, len(events))
                except Exception as refresh_err:
                    logger.warning("用户 %s token 刷新失败: %s", user.name, refresh_err)
                    continue

            if events is None:
                logger.warning("用户 %s 无法获取日历事件（token 无效且无法刷新）", user.name)
                continue

            # 已提醒事件集合（兼容旧字段 + 新字段）
            already_reminded: set[str] = set(pref.reminded_event_ids or [])
            if pref.last_reminded_event_id:
                already_reminded.add(pref.last_reminded_event_id)

            for event in events:
                event_id = event.get("event_id", "")
                if not event_id:
                    continue

                # 跳过已取消的事件
                if event.get("status") == "cancelled":
                    continue

                # 跳过已提醒的事件
                if event_id in already_reminded:
                    continue

                summary = event.get("summary", "无标题会议")
                description = event.get("description")
                start_info = event.get("start_time", {})
                start_ts = start_info.get("timestamp")
                if not start_ts:
                    continue

                start_dt = datetime.fromtimestamp(int(start_ts), tz=ZoneInfo("Asia/Shanghai"))

                # 跳过已经开始的会议（会前提醒只对未来的事件有意义）
                if start_dt <= now:
                    continue

                time_str = start_dt.strftime("%H:%M")

                location = ""
                loc_info = event.get("location")
                if loc_info:
                    location = loc_info.get("name") or loc_info.get("address") or ""

                # 解析参会人名单
                attendee_names = []
                raw_attendees = event.get("attendees", [])
                for att in raw_attendees:
                    name = att.get("display_name") or att.get("name")
                    if name:
                        attendee_names.append(name)

                # ── 生成 AI 会前简报 ──
                brief_text = ""
                try:
                    async with async_session() as db:
                        owner_id = user.feishu_open_id
                        visible_ids = await get_visible_owner_ids(user, db)

                        context = await gather_meeting_context(
                            db=db,
                            owner_id=owner_id,
                            visible_ids=visible_ids,
                            event_summary=summary,
                            event_description=description,
                            attendee_names=attendee_names,
                        )

                        system_prompt = build_brief_prompt(
                            event_summary=summary,
                            event_description=description,
                            start_time=start_dt,
                            attendee_names=attendee_names,
                            context=context,
                        )

                    client = create_openai_client(
                        api_key=settings.agent_llm_api_key,
                        base_url=settings.agent_llm_base_url,
                        timeout=120.0,
                    )
                    messages = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"请为我的会议「{summary}」生成简洁的会前准备简报，控制在 500 字以内。"},
                    ]
                    resp = await client.chat.completions.create(
                        model=settings.agent_llm_model,
                        messages=messages,
                    )
                    brief_text = resp.choices[0].message.content or ""
                    logger.info("已为 %s 生成会前简报: %s (长度: %d)", user.name, summary, len(brief_text))
                except Exception as e:
                    logger.warning("为 %s 生成会前简报失败: %s，将发送基础提醒", user.name, e)

                # ── 构建飞书消息卡片 ──
                elements = [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": (
                                f"⏰ **时间**: {time_str}\n"
                                f"📍 **地点**: {location or '未指定'}\n"
                                f"👥 **参会人**: {'、'.join(attendee_names[:8]) or '未知'}"
                                + (f" 等{len(attendee_names)}人" if len(attendee_names) > 8 else "")
                            ),
                        },
                    },
                ]

                if brief_text:
                    # 飞书卡片文本限制，截断过长内容
                    truncated = brief_text[:2000]
                    elements.append({"tag": "hr"})
                    elements.append({
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": f"**📋 AI 会前简报**\n\n{truncated}",
                        },
                    })
                else:
                    elements.append({
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": f"💡 距离会议开始还有约 **{pref.minutes_before} 分钟**",
                        },
                    })

                card = {
                    "config": {"wide_screen_mode": True},
                    "header": {
                        "title": {"tag": "plain_text", "content": f"📅 会议提醒: {summary}"},
                        "template": "blue",
                    },
                    "elements": elements,
                }

                content = json.dumps(card, ensure_ascii=False)
                try:
                    await feishu_client.send_bot_message(
                        receive_id=user.feishu_open_id,
                        msg_type="interactive",
                        content=content,
                    )
                    reminded_count += 1
                    already_reminded.add(event_id)

                    # 更新提醒记录：追加到已提醒列表，只保留最近50条
                    async with async_session() as db:
                        result = await db.execute(
                            select(CalendarReminderPref).where(
                                CalendarReminderPref.id == pref.id,
                            )
                        )
                        p = result.scalar_one_or_none()
                        if p:
                            ids_list = list(p.reminded_event_ids or [])
                            ids_list.append(event_id)
                            p.reminded_event_ids = ids_list[-50:]
                            flag_modified(p, "reminded_event_ids")
                            p.last_reminded_event_id = event_id
                            p.last_reminded_at = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
                            await db.commit()

                    logger.info("已向 %s 发送会议提醒+简报: %s", user.name, summary)
                except FeishuAPIError as e:
                    logger.warning("向 %s 发送提醒失败: %s", user.name, e)

        except Exception as e:
            logger.warning("用户 %s 日程提醒失败: %s", user.feishu_open_id, e)

    logger.info("日程提醒任务完成，共发送 %d 条提醒", reminded_count)
