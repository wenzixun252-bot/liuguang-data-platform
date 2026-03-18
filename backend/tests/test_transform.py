"""ETL Transform 模块单元测试。"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.etl.extractor import ExtractionResult
from app.services.etl.transformer import DataTransformer, TransformedDocument

pytestmark = pytest.mark.asyncio


class TestDataTransformer:
    """DataTransformer 测试。"""

    def _make_extraction(self, records=None, schema_fields=None):
        return ExtractionResult(
            records=records or [],
            schema_fields=schema_fields or [{"field_name": "标题", "type": 1}],
            app_token="app1",
            table_id="tbl1",
        )

    async def test_transform_empty_records(self, db_session):
        """空记录列表直接返回空结果。"""
        extraction = self._make_extraction(records=[])
        t = DataTransformer()
        result = await t.transform(extraction, "conversation", db_session)
        assert result.records == []
        assert result.discarded_count == 0

    async def test_apply_mapping_basic(self):
        """基本的字段映射。"""
        t = DataTransformer()
        mapping = {
            "feishu_record_id": "record_id_field",
            "owner_id": "creator",
            "title": "标题",
            "content_text": "内容",
            "feishu_created_at": None,
            "feishu_updated_at": None,
        }
        raw_record = {
            "record_id": "rec_001",
            "fields": {
                "record_id_field": "rec_001",
                "creator": "ou_abc123",
                "标题": "测试标题",
                "内容": "这是正文内容",
                "额外字段": "会进入 asset_tags",
            },
        }

        result = t._apply_mapping(raw_record, mapping, "app1", "tbl1", "conversation", default_owner_id="ou_abc123")

        assert result is not None
        assert result.feishu_record_id == "rec_001"
        assert result.owner_id == "ou_abc123"
        assert result.title == "测试标题"
        assert result.content_text == "这是正文内容"
        assert "额外字段" in result.extra_fields
        assert result.extra_fields["额外字段"] == "会进入 asset_tags"

    async def test_apply_mapping_missing_critical_fields(self):
        """关键字段缺失时返回 None (丢弃记录)。"""
        t = DataTransformer()
        mapping = {
            "feishu_record_id": "id",
            "owner_id": "creator",
            "content_text": "content",
        }
        # 缺少 content_text
        raw_record = {
            "record_id": "rec_001",
            "fields": {
                "id": "rec_001",
                "creator": "ou_abc",
                # "content" 字段不存在
            },
        }

        result = t._apply_mapping(raw_record, mapping, "app1", "tbl1", "conversation", default_owner_id="ou_abc")
        assert result is None

    async def test_apply_mapping_unmapped_fields_to_asset_tags(self):
        """未映射的字段打包到 extra_fields。"""
        t = DataTransformer()
        mapping = {
            "feishu_record_id": None,
            "owner_id": "creator",
            "content_text": "body",
        }
        raw_record = {
            "record_id": "rec_001",
            "fields": {
                "creator": "ou_abc",
                "body": "正文",
                "tag1": "标签1",
                "tag2": 42,
                "tag3": ["a", "b"],
            },
        }

        result = t._apply_mapping(raw_record, mapping, "app1", "tbl1", "conversation", default_owner_id="ou_abc")

        assert result is not None
        assert "tag1" in result.extra_fields
        assert "tag2" in result.extra_fields
        assert "tag3" in result.extra_fields

    async def test_parse_time_milliseconds(self):
        """毫秒时间戳正确解析。"""
        t = DataTransformer()
        ts_ms = 1700000000000  # 2023-11-14T22:13:20Z
        result = t._parse_time(ts_ms)
        assert result is not None
        assert result.year == 2023

    async def test_parse_time_iso_string(self):
        """ISO 时间字符串正确解析。"""
        t = DataTransformer()
        result = t._parse_time("2024-01-15T10:30:00+08:00")
        assert result is not None
        assert result.year == 2024

    async def test_extract_text_complex_types(self):
        """复杂飞书字段类型正确提取文本。"""
        t = DataTransformer()
        # 人员字段
        assert t._extract_text([{"name": "张三"}, {"name": "李四"}]) == "张三 李四"
        # 纯文本
        assert t._extract_text("hello") == "hello"
        # 数字
        assert t._extract_text(42) == "42"
        # None
        assert t._extract_text(None) == ""

    async def test_transform_with_cache_hit(self, db_session):
        """Schema 映射缓存命中时不调用 LLM。"""
        # 预先写入缓存 (需要 SchemaMappingCache 表, 但 SQLite 不支持 JSONB)
        # 所以这里 mock _get_or_create_mapping
        t = DataTransformer()
        extraction = self._make_extraction(
            records=[
                {
                    "record_id": "rec_001",
                    "fields": {"id": "rec_001", "owner": "ou_abc", "text": "内容"},
                }
            ]
        )

        mapping = {
            "feishu_record_id": "id",
            "owner_id": "owner",
            "content_text": "text",
            "title": None,
            "feishu_created_at": None,
            "feishu_updated_at": None,
        }

        with patch.object(t, "_get_or_create_mapping", new_callable=AsyncMock, return_value=mapping):
            result = await t.transform(extraction, "conversation", db_session, owner_id="ou_abc")

        assert len(result.records) == 1
        assert result.records[0].content_text == "内容"
        assert result.discarded_count == 0

    async def test_transform_llm_failure_sends_alert(self, db_session):
        """LLM 映射失败时发送告警。"""
        from app.services.etl.transformer import LLMError

        t = DataTransformer()
        extraction = self._make_extraction(
            records=[{"record_id": "r1", "fields": {"a": "b"}}]
        )

        with (
            patch.object(
                t, "_get_or_create_mapping",
                new_callable=AsyncMock,
                side_effect=LLMError("LLM 不可用"),
            ),
            patch(
                "app.services.etl.transformer.send_alert",
                new_callable=AsyncMock,
            ) as mock_alert,
        ):
            result = await t.transform(extraction, "conversation", db_session)

        assert result.records == []
        mock_alert.assert_called_once()
