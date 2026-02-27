"""ETL 定时任务定义。"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import async_session
from app.models.asset import ETLSyncState
from app.services.etl.extractor import incremental_extractor, registry_reader
from app.services.etl.loader import asset_loader
from app.services.etl.transformer import data_transformer

logger = logging.getLogger(__name__)


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
            state.last_sync_time = datetime.now(timezone.utc)
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

    for entry in entries:
        try:
            async with async_session() as db:
                # 1. Extract — 增量抽取
                extraction = await incremental_extractor.extract(entry, db)
                count = len(extraction.records)
                total_extracted += count

                if not extraction.records:
                    logger.info("数据源 %s/%s 无增量数据", entry.app_token, entry.table_id)
                    # 标记为成功（无新数据也算成功）
                    result = await db.execute(
                        select(ETLSyncState).where(
                            ETLSyncState.source_app_token == entry.app_token,
                            ETLSyncState.source_table_id == entry.table_id,
                        )
                    )
                    state = result.scalar_one_or_none()
                    if state:
                        state.last_sync_status = "success"
                        state.last_sync_time = datetime.now(timezone.utc)
                        await db.commit()
                    continue

                # 2. Transform — Schema 映射 + 数据清洗
                transform_result = await data_transformer.transform(
                    extraction, entry.asset_type, db
                )

                if not transform_result.records:
                    logger.info("数据源 %s/%s 转换后无有效记录", entry.app_token, entry.table_id)
                    continue

                # 3. Load — Embedding + Upsert
                loaded = await asset_loader.load(transform_result, db)
                total_loaded += loaded

                # 标记成功
                result = await db.execute(
                    select(ETLSyncState).where(
                        ETLSyncState.source_app_token == entry.app_token,
                        ETLSyncState.source_table_id == entry.table_id,
                    )
                )
                state = result.scalar_one_or_none()
                if state:
                    state.last_sync_status = "success"
                    state.records_synced = loaded
                    state.last_sync_time = datetime.now(timezone.utc)
                    state.error_message = None
                    await db.commit()

        except Exception as e:
            logger.error("ETL 同步数据源 %s/%s 失败: %s", entry.app_token, entry.table_id, e)
            await _mark_failed(entry.app_token, entry.table_id, str(e))

    logger.info(
        "ETL 同步任务完成，共抽取 %d 条, 入库 %d 条",
        total_extracted,
        total_loaded,
    )
