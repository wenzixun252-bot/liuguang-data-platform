"""ETL 定时任务定义。"""

import logging

from app.database import async_session
from app.services.etl.extractor import incremental_extractor, registry_reader
from app.services.etl.loader import asset_loader
from app.services.etl.transformer import data_transformer

logger = logging.getLogger(__name__)


async def etl_sync_job() -> None:
    """定时任务入口：遍历注册中心 → 逐表增量抽取 → Transform → Load。"""
    logger.info("ETL 同步任务开始")

    entries = await registry_reader.read()
    if not entries:
        logger.info("注册中心为空或未配置，跳过本轮同步")
        return

    total_extracted = 0
    total_loaded = 0

    for entry in entries:
        async with async_session() as db:
            # 1. Extract — 增量抽取
            extraction = await incremental_extractor.extract(entry, db)
            count = len(extraction.records)
            total_extracted += count

            if not extraction.records:
                logger.info("数据源 %s/%s 无增量数据", entry.app_token, entry.table_id)
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

    logger.info(
        "ETL 同步任务完成，共抽取 %d 条, 入库 %d 条",
        total_extracted,
        total_loaded,
    )
