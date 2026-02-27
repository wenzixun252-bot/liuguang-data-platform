"""ETL Extract 模块单元测试。"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import ETLSyncState
from app.services.etl.extractor import (
    ExtractionResult,
    IncrementalExtractor,
    RegistryEntry,
    RegistryReader,
)

pytestmark = pytest.mark.asyncio


# ── RegistryReader 测试 ──────────────────────────────────


class TestRegistryReader:
    async def test_read_returns_enabled_entries(self):
        """仅返回 is_enabled=True 的记录。"""
        mock_records = [
            {
                "fields": {
                    "app_token": "app1",
                    "table_id": "tbl1",
                    "table_name": "测试表1",
                    "asset_type": "conversation",
                    "is_enabled": True,
                }
            },
            {
                "fields": {
                    "app_token": "app2",
                    "table_id": "tbl2",
                    "table_name": "已禁用表",
                    "asset_type": "document",
                    "is_enabled": False,
                }
            },
            {
                "fields": {
                    "app_token": "app3",
                    "table_id": "tbl3",
                    "table_name": "测试表3",
                    "asset_type": "meeting_note",
                }
            },
        ]

        with (
            patch("app.services.etl.extractor.settings") as mock_settings,
            patch(
                "app.services.etl.extractor.feishu_client.list_all_bitable_records",
                new_callable=AsyncMock,
                return_value=mock_records,
            ),
        ):
            mock_settings.etl_registry_app_token = "reg_app"
            mock_settings.etl_registry_table_id = "reg_tbl"

            reader = RegistryReader()
            entries = await reader.read()

        # app2 被过滤 (is_enabled=False)
        assert len(entries) == 2
        assert entries[0].app_token == "app1"
        assert entries[1].app_token == "app3"

    async def test_read_empty_config(self):
        """注册中心未配置时返回空列表。"""
        with patch("app.services.etl.extractor.settings") as mock_settings:
            mock_settings.etl_registry_app_token = ""
            mock_settings.etl_registry_table_id = ""

            reader = RegistryReader()
            entries = await reader.read()

        assert entries == []

    async def test_read_skips_incomplete_entries(self):
        """缺少 app_token 或 table_id 的记录被跳过。"""
        mock_records = [
            {"fields": {"app_token": "app1", "table_id": ""}},
            {"fields": {"app_token": "", "table_id": "tbl2"}},
            {"fields": {"app_token": "app3", "table_id": "tbl3"}},
        ]

        with (
            patch("app.services.etl.extractor.settings") as mock_settings,
            patch(
                "app.services.etl.extractor.feishu_client.list_all_bitable_records",
                new_callable=AsyncMock,
                return_value=mock_records,
            ),
        ):
            mock_settings.etl_registry_app_token = "reg_app"
            mock_settings.etl_registry_table_id = "reg_tbl"

            reader = RegistryReader()
            entries = await reader.read()

        assert len(entries) == 1
        assert entries[0].app_token == "app3"

    async def test_read_feishu_api_error_sends_alert(self):
        """飞书 API 失败时发送告警并返回空列表。"""
        from app.services.feishu import FeishuAPIError

        with (
            patch("app.services.etl.extractor.settings") as mock_settings,
            patch(
                "app.services.etl.extractor.feishu_client.list_all_bitable_records",
                new_callable=AsyncMock,
                side_effect=FeishuAPIError("API 限流"),
            ),
            patch(
                "app.services.etl.extractor.send_alert",
                new_callable=AsyncMock,
            ) as mock_alert,
        ):
            mock_settings.etl_registry_app_token = "reg_app"
            mock_settings.etl_registry_table_id = "reg_tbl"

            reader = RegistryReader()
            entries = await reader.read()

        assert entries == []
        mock_alert.assert_called_once()


# ── IncrementalExtractor 测试 ────────────────────────────


class TestIncrementalExtractor:
    async def test_extract_creates_sync_state(self, db_session: AsyncSession):
        """首次抽取时自动创建 sync_state 记录。"""
        entry = RegistryEntry(app_token="app1", table_id="tbl1")

        with (
            patch(
                "app.services.etl.extractor.feishu_client.get_bitable_fields",
                new_callable=AsyncMock,
                return_value=[{"field_name": "title", "type": 1}],
            ),
            patch(
                "app.services.etl.extractor.feishu_client.list_all_bitable_records",
                new_callable=AsyncMock,
                return_value=[{"record_id": "r1", "fields": {"title": "test"}}],
            ),
        ):
            extractor = IncrementalExtractor()
            result = await extractor.extract(entry, db_session)

        assert len(result.records) == 1
        assert len(result.schema_fields) == 1

        # 验证 sync_state 被创建且状态为 running
        state = await db_session.execute(
            select(ETLSyncState).where(
                ETLSyncState.source_app_token == "app1",
                ETLSyncState.source_table_id == "tbl1",
            )
        )
        sync_state = state.scalar_one()
        assert sync_state.last_sync_status == "running"

    async def test_extract_failure_marks_failed(self, db_session: AsyncSession):
        """抽取失败时标记状态为 failed 并发送告警。"""
        from app.services.feishu import FeishuAPIError

        entry = RegistryEntry(app_token="app1", table_id="tbl1")

        with (
            patch(
                "app.services.etl.extractor.feishu_client.get_bitable_fields",
                new_callable=AsyncMock,
                side_effect=FeishuAPIError("读取失败"),
            ),
            patch(
                "app.services.etl.extractor.send_alert",
                new_callable=AsyncMock,
            ) as mock_alert,
        ):
            extractor = IncrementalExtractor()
            result = await extractor.extract(entry, db_session)

        assert result.records == []
        mock_alert.assert_called_once()

        state = await db_session.execute(
            select(ETLSyncState).where(
                ETLSyncState.source_app_token == "app1",
            )
        )
        sync_state = state.scalar_one()
        assert sync_state.last_sync_status == "failed"
        assert "读取失败" in sync_state.error_message


# ── Webhook 测试 ─────────────────────────────────────────


class TestWebhook:
    async def test_send_alert_no_url(self):
        """Webhook URL 未配置时跳过发送。"""
        from app.utils.feishu_webhook import send_alert

        with patch("app.utils.feishu_webhook.settings") as mock_settings:
            mock_settings.feishu_webhook_url = ""
            result = await send_alert("测试告警", "详情")

        assert result is False

    async def test_send_alert_success(self):
        """Webhook 正常发送。"""
        from unittest.mock import MagicMock

        from app.utils.feishu_webhook import send_alert

        # httpx response 的 json() 和 raise_for_status() 是同步方法
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"code": 0}
        mock_resp.raise_for_status.return_value = None

        with (
            patch("app.utils.feishu_webhook.settings") as mock_settings,
            patch("app.utils.feishu_webhook.httpx.AsyncClient") as mock_client_cls,
        ):
            mock_settings.feishu_webhook_url = "https://webhook.example.com"
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await send_alert("测试", "内容")

        assert result is True
        mock_client.post.assert_called_once()
