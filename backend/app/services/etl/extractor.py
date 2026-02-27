"""ETL Extract 模块 — 注册中心读取 + 增量数据拉取。"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
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
    asset_type: str = "conversation"
    is_enabled: bool = True


class RegistryReader:
    """从飞书多维表格注册中心读取目标表信息。"""

    async def read(self) -> list[RegistryEntry]:
        """读取注册中心，仅返回 is_enabled=True 的记录。"""
        app_token = settings.etl_registry_app_token
        table_id = settings.etl_registry_table_id

        if not app_token or not table_id:
            logger.warning("ETL 注册中心未配置 (app_token 或 table_id 为空)")
            return []

        try:
            records = await feishu_client.list_all_bitable_records(app_token, table_id)
        except FeishuAPIError as e:
            logger.error("读取注册中心失败: %s", e)
            await send_alert("注册中心读取失败", f"错误: {e}")
            return []

        entries: list[RegistryEntry] = []
        for record in records:
            fields = record.get("fields", {})
            is_enabled = fields.get("is_enabled")
            # 飞书多维表格复选框字段值可能是 True/False 或文本
            if isinstance(is_enabled, bool) and not is_enabled:
                continue
            if isinstance(is_enabled, str) and is_enabled.lower() in ("false", "0", "no"):
                continue

            entry = RegistryEntry(
                app_token=str(fields.get("app_token", "")),
                table_id=str(fields.get("table_id", "")),
                table_name=str(fields.get("table_name", "")),
                asset_type=str(fields.get("asset_type", "conversation")),
                is_enabled=True,
            )
            if entry.app_token and entry.table_id:
                entries.append(entry)
            else:
                logger.warning("注册中心记录缺少 app_token 或 table_id，已跳过: %s", fields)

        logger.info("注册中心已读取 %d 条有效数据源", len(entries))
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
    ) -> ExtractionResult:
        """对指定数据源执行增量拉取。

        1. 读取 etl_sync_state 获取 last_sync_time
        2. 构建 filter: update_time > last_sync_time
        3. 分页抓取所有增量记录
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

        # 构建增量过滤条件 (飞书多维表格用毫秒时间戳)
        filter_expr = None
        epoch = datetime(1970, 1, 2, tzinfo=timezone.utc)
        if last_sync_time and last_sync_time > epoch:
            ts_ms = int(last_sync_time.timestamp() * 1000)
            filter_expr = f'CurrentValue.[最后更新时间] > {ts_ms}'

        try:
            # 获取源表 Schema
            schema_fields = await feishu_client.get_bitable_fields(
                entry.app_token, entry.table_id
            )

            # 拉取增量记录
            records = await feishu_client.list_all_bitable_records(
                entry.app_token, entry.table_id, filter_expr=filter_expr
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

        except FeishuAPIError as e:
            logger.error("增量抽取失败: %s", e)
            sync_state.last_sync_status = "failed"
            sync_state.error_message = str(e)
            await db.commit()
            await send_alert(
                f"ETL 抽取失败: {entry.table_name or entry.table_id}",
                f"数据源: `{entry.app_token}/{entry.table_id}`\n错误: {e}",
            )
            return ExtractionResult(app_token=entry.app_token, table_id=entry.table_id)


# 模块级单例
registry_reader = RegistryReader()
incremental_extractor = IncrementalExtractor()
