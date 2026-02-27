"""ETL Transform 模块 — Schema 映射缓存 + 数据转换。"""

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import SchemaMappingCache
from app.services.etl.extractor import ExtractionResult
from app.services.llm import LLMError, llm_client
from app.utils.feishu_webhook import send_alert

logger = logging.getLogger(__name__)

# 关键字段 — 缺失则丢弃该记录
REQUIRED_FIELDS = {"feishu_record_id", "owner_id", "content_text"}


@dataclass
class TransformedRecord:
    """转换后的标准记录。"""

    feishu_record_id: str
    owner_id: str
    source_app_token: str
    source_table_id: str
    asset_type: str = "conversation"
    title: str | None = None
    content_text: str = ""
    asset_tags: dict = field(default_factory=dict)
    feishu_created_at: datetime | None = None
    feishu_updated_at: datetime | None = None


@dataclass
class TransformResult:
    """转换结果。"""

    records: list[TransformedRecord] = field(default_factory=list)
    discarded_count: int = 0
    app_token: str = ""
    table_id: str = ""


class DataTransformer:
    """Schema 映射缓存 + 数据清洗转换。"""

    async def transform(
        self,
        extraction: ExtractionResult,
        asset_type: str,
        db: AsyncSession,
    ) -> TransformResult:
        """对抽取结果执行 Schema 映射 + 数据转换。"""
        if not extraction.records:
            return TransformResult(
                app_token=extraction.app_token, table_id=extraction.table_id
            )

        # 1. 获取 Schema 映射（带缓存）
        try:
            mapping = await self._get_or_create_mapping(
                extraction.schema_fields,
                extraction.app_token,
                extraction.table_id,
                db,
            )
        except LLMError as e:
            logger.error("Schema 映射失败，跳过本表: %s", e)
            await send_alert(
                f"Schema 映射失败: {extraction.table_id}",
                f"数据源: `{extraction.app_token}/{extraction.table_id}`\n错误: {e}",
            )
            return TransformResult(
                app_token=extraction.app_token, table_id=extraction.table_id
            )

        # 2. 逐条转换
        transformed: list[TransformedRecord] = []
        discarded = 0

        for raw_record in extraction.records:
            record = self._apply_mapping(
                raw_record, mapping, extraction.app_token, extraction.table_id, asset_type
            )
            if record is None:
                discarded += 1
                continue
            transformed.append(record)

        if discarded > 0:
            logger.warning(
                "数据源 %s/%s: 丢弃 %d 条关键字段缺失的记录",
                extraction.app_token,
                extraction.table_id,
                discarded,
            )
            await send_alert(
                f"ETL 数据清洗告警: {extraction.table_id}",
                f"数据源: `{extraction.app_token}/{extraction.table_id}`\n"
                f"丢弃 {discarded} 条关键字段缺失的记录",
            )

        logger.info(
            "数据转换完成: %s/%s, 有效 %d 条, 丢弃 %d 条",
            extraction.app_token,
            extraction.table_id,
            len(transformed),
            discarded,
        )

        return TransformResult(
            records=transformed,
            discarded_count=discarded,
            app_token=extraction.app_token,
            table_id=extraction.table_id,
        )

    # ── Schema 映射缓存 ─────────────────────────────────

    async def _get_or_create_mapping(
        self,
        schema_fields: list[dict],
        app_token: str,
        table_id: str,
        db: AsyncSession,
    ) -> dict:
        """获取 Schema 映射，优先从缓存读取。"""
        schema_json = json.dumps(schema_fields, sort_keys=True, ensure_ascii=False)
        schema_md5 = hashlib.md5(schema_json.encode()).hexdigest()

        # 查缓存
        result = await db.execute(
            select(SchemaMappingCache).where(
                SchemaMappingCache.source_app_token == app_token,
                SchemaMappingCache.source_table_id == table_id,
                SchemaMappingCache.schema_md5 == schema_md5,
            )
        )
        cached = result.scalar_one_or_none()

        if cached is not None:
            logger.info("Schema 映射缓存命中: %s/%s (md5=%s)", app_token, table_id, schema_md5)
            return cached.mapping_result

        # 缓存未命中，调用 LLM
        logger.info("Schema 映射缓存未命中，调用 LLM: %s/%s", app_token, table_id)
        mapping = await llm_client.schema_mapping(schema_fields)

        # 写入缓存
        cache_entry = SchemaMappingCache(
            source_app_token=app_token,
            source_table_id=table_id,
            schema_md5=schema_md5,
            mapping_result=mapping,
        )
        db.add(cache_entry)
        await db.commit()

        return mapping

    # ── 数据转换 ─────────────────────────────────────────

    def _apply_mapping(
        self,
        raw_record: dict,
        mapping: dict,
        app_token: str,
        table_id: str,
        asset_type: str,
    ) -> TransformedRecord | None:
        """按映射规则将源记录转换为标准记录。"""
        fields = raw_record.get("fields", {})
        record_id = raw_record.get("record_id", "")

        # 按映射规则提取标准字段
        mapped_values: dict = {}
        mapped_source_fields: set = set()

        for target_field, source_field in mapping.items():
            if source_field and source_field in fields:
                mapped_values[target_field] = fields[source_field]
                mapped_source_fields.add(source_field)

        # feishu_record_id 优先从 record_id 取
        feishu_record_id = str(mapped_values.get("feishu_record_id", record_id or ""))
        owner_id = self._extract_text(mapped_values.get("owner_id", ""))
        title = self._extract_text(mapped_values.get("title"))
        content_text = self._extract_text(mapped_values.get("content_text", ""))

        # 关键字段校验
        if not feishu_record_id or not owner_id or not content_text:
            logger.warning(
                "记录缺少关键字段 (record_id=%s, owner_id=%s, content_text=%s)，丢弃",
                bool(feishu_record_id),
                bool(owner_id),
                bool(content_text),
            )
            return None

        # 未映射字段 → asset_tags
        asset_tags: dict = {}
        for source_field, value in fields.items():
            if source_field not in mapped_source_fields:
                asset_tags[source_field] = value

        # 时间处理
        feishu_created_at = self._parse_time(mapped_values.get("feishu_created_at"))
        feishu_updated_at = self._parse_time(mapped_values.get("feishu_updated_at"))

        return TransformedRecord(
            feishu_record_id=feishu_record_id,
            owner_id=owner_id,
            source_app_token=app_token,
            source_table_id=table_id,
            asset_type=asset_type,
            title=title,
            content_text=content_text,
            asset_tags=asset_tags,
            feishu_created_at=feishu_created_at,
            feishu_updated_at=feishu_updated_at,
        )

    @staticmethod
    def _extract_text(value) -> str:
        """从飞书字段值中提取纯文本（处理富文本、人员等复杂类型）。"""
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, list):
            # 人员字段 [{"id": "xxx", "name": "张三"}] 或富文本段落
            parts = []
            for item in value:
                if isinstance(item, dict):
                    parts.append(item.get("text", item.get("name", str(item))))
                else:
                    parts.append(str(item))
            return " ".join(parts).strip()
        if isinstance(value, dict):
            return value.get("text", value.get("name", str(value)))
        return str(value)

    @staticmethod
    def _parse_time(value) -> datetime | None:
        """将飞书时间字段（毫秒时间戳或 ISO 字符串）转为 datetime。"""
        if value is None:
            return None
        if isinstance(value, (int, float)):
            # 飞书毫秒时间戳
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None


# 模块级单例
data_transformer = DataTransformer()
