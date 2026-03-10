"""ETL Extract 模块 — 注册中心读取 + 增量数据拉取。"""

import logging
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import ETLSyncState
from app.services.feishu import FeishuAPIError, feishu_client
from app.utils.feishu_webhook import send_alert

logger = logging.getLogger(__name__)


@dataclass
class RegistryEntry:
    """注册中心中的一条数据源配置。"""

    app_token: str
    table_id: str
    table_name: str = ""
    asset_type: str = "document"
    is_enabled: bool = True
    owner_id: str | None = None


class RegistryReader:
    """从本地数据库读取已启用的数据源配置。"""

    async def read(self) -> list[RegistryEntry]:
        """从 etl_data_sources 表读取已启用的数据源。"""
        from app.database import async_session
        from app.models.asset import ETLDataSource

        async with async_session() as db:
            result = await db.execute(
                select(ETLDataSource).where(ETLDataSource.is_enabled == True)  # noqa: E712
            )
            rows = result.scalars().all()

        entries = [
            RegistryEntry(
                app_token=row.app_token,
                table_id=row.table_id,
                table_name=row.table_name,
                asset_type=row.asset_type,
                is_enabled=True,
                owner_id=row.owner_id,
            )
            for row in rows
        ]
        logger.info("本地数据源已读取 %d 条", len(entries))
        return entries


@dataclass
class ExtractionResult:
    """增量抽取结果。"""

    records: list[dict] = field(default_factory=list)
    schema_fields: list[dict] = field(default_factory=list)
    app_token: str = ""
    table_id: str = ""


class IncrementalExtractor:
    """增量数据拉取引擎。"""

    async def extract(
        self,
        entry: RegistryEntry,
        db: AsyncSession,
        user_access_token: str | None = None,
        force_full: bool = False,
    ) -> ExtractionResult:
        """对指定数据源执行数据拉取。

        force_full=True 时跳过增量过滤，全量拉取所有记录（手动触发同步时使用）。
        全量拉取后靠 loader 的 ON CONFLICT upsert 去重，已有记录更新、新记录插入。

        1. 读取 etl_sync_state 获取 last_sync_time
        2. 构建 filter: update_time > last_sync_time（force_full 时跳过）
        3. 分页抓取所有增量/全量记录
        4. 更新状态为 running
        """
        # 获取或创建同步状态
        result = await db.execute(
            select(ETLSyncState).where(
                ETLSyncState.source_app_token == entry.app_token,
                ETLSyncState.source_table_id == entry.table_id,
            )
        )
        sync_state = result.scalar_one_or_none()

        if sync_state is None:
            sync_state = ETLSyncState(
                source_app_token=entry.app_token,
                source_table_id=entry.table_id,
                last_sync_status="idle",
            )
            db.add(sync_state)
            await db.commit()
            await db.refresh(sync_state)

        last_sync_time = sync_state.last_sync_time

        # 更新状态为 running
        sync_state.last_sync_status = "running"
        await db.commit()

        try:
            # 获取源表 Schema
            schema_fields = await feishu_client.get_bitable_fields(
                entry.app_token, entry.table_id,
                user_access_token=user_access_token,
            )

            # 构建过滤条件：force_full 时跳过增量过滤，全量拉取
            filter_expr = None
            if force_full:
                logger.info("强制全量拉取（手动触发）: %s/%s", entry.app_token, entry.table_id)
            else:
                epoch = datetime(1970, 1, 2)
                if last_sync_time and last_sync_time > epoch:
                    ts_ms = int(last_sync_time.timestamp() * 1000)
                    time_field = self._find_update_time_field(schema_fields)
                    if time_field:
                        filter_expr = f'CurrentValue.[{time_field}] > {ts_ms}'
                        logger.info("使用增量过滤: %s > %d", time_field, ts_ms)
                    else:
                        logger.info("未找到时间字段，全量拉取: %s/%s", entry.app_token, entry.table_id)

            # 拉取记录
            records = await feishu_client.list_all_bitable_records(
                entry.app_token, entry.table_id, filter_expr=filter_expr,
                user_access_token=user_access_token,
            )

            logger.info(
                "增量抽取完成: %s/%s, 获取 %d 条记录",
                entry.app_token,
                entry.table_id,
                len(records),
            )

            return ExtractionResult(
                records=records,
                schema_fields=schema_fields,
                app_token=entry.app_token,
                table_id=entry.table_id,
            )

        except (FeishuAPIError, Exception) as e:
            logger.error("增量抽取失败: %s", e)
            sync_state.last_sync_status = "failed"
            sync_state.error_message = str(e)
            await db.commit()
            await send_alert(
                f"ETL 抽取失败: {entry.table_name or entry.table_id}",
                f"数据源: `{entry.app_token}/{entry.table_id}`\n错误: {e}",
            )
            return ExtractionResult(app_token=entry.app_token, table_id=entry.table_id)


    @staticmethod
    def _find_update_time_field(schema_fields: list[dict]) -> str | None:
        """在 schema 中查找更新时间相关字段。"""
        time_keywords = ["最后更新时间", "更新时间", "修改时间", "最近修改", "updated", "last_modified"]
        field_names = [f.get("field_name", "") for f in schema_fields]
        # 精确匹配
        for kw in time_keywords:
            for fn in field_names:
                if fn == kw:
                    return fn
        # 包含匹配
        for kw in time_keywords:
            for fn in field_names:
                if kw in fn.lower():
                    return fn
        return None


# 模块级单例
registry_reader = RegistryReader()
incremental_extractor = IncrementalExtractor()
