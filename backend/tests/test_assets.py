"""数据资产接口单元测试。"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


class TestAssetEndpointsAuth:
    """资产接口认证测试。"""

    async def test_stats_requires_auth(self, client):
        """未认证用户无法访问统计接口。"""
        resp = await client.get("/api/assets/stats")
        assert resp.status_code in (401, 403)

    async def test_list_requires_auth(self, client):
        """未认证用户无法访问列表接口。"""
        resp = await client.get("/api/assets/list")
        assert resp.status_code in (401, 403)

    async def test_detail_requires_auth(self, client):
        """未认证用户无法访问详情接口。"""
        resp = await client.get("/api/assets/nonexistent")
        assert resp.status_code in (401, 403)


class TestAssetRLS:
    """资产行级安全测试。"""

    def test_apply_rls_employee(self):
        """employee 用户查询附加 owner_id 过滤。"""
        from unittest.mock import MagicMock
        from app.api.assets import _apply_rls
        from app.models.user import User

        user = MagicMock(spec=User)
        user.role = "employee"
        user.feishu_open_id = "ou_123"

        stmt = MagicMock()
        result = _apply_rls(stmt, user)
        # employee 用户应调用 where 过滤
        stmt.where.assert_called_once()

    def test_apply_rls_admin(self):
        """admin 用户查询不附加过滤。"""
        from unittest.mock import MagicMock
        from app.api.assets import _apply_rls
        from app.models.user import User

        user = MagicMock(spec=User)
        user.role = "admin"

        stmt = MagicMock()
        result = _apply_rls(stmt, user)
        # admin 用户不应调用 where
        stmt.where.assert_not_called()

    def test_apply_rls_executive(self):
        """executive 用户查询不附加过滤。"""
        from unittest.mock import MagicMock
        from app.api.assets import _apply_rls
        from app.models.user import User

        user = MagicMock(spec=User)
        user.role = "executive"

        stmt = MagicMock()
        result = _apply_rls(stmt, user)
        stmt.where.assert_not_called()


class TestAssetSchemas:
    """资产 Schema 测试。"""

    def test_asset_out_schema(self):
        """AssetOut schema 可正确序列化。"""
        from datetime import datetime
        from app.schemas.asset import AssetOut

        asset = AssetOut(
            feishu_record_id="rec_123",
            title="测试标题",
            asset_type="conversation",
            content_text="测试内容",
            asset_tags={"key": "value"},
            synced_at=datetime(2024, 1, 1),
        )
        data = asset.model_dump()
        assert data["feishu_record_id"] == "rec_123"
        assert data["title"] == "测试标题"
        assert data["asset_tags"] == {"key": "value"}

    def test_asset_list_response_schema(self):
        """AssetListResponse schema 可正确序列化。"""
        from app.schemas.asset import AssetListResponse

        resp = AssetListResponse(items=[], total=0, page=1, page_size=20)
        data = resp.model_dump()
        assert data["total"] == 0
        assert data["items"] == []

    def test_asset_stats_response_schema(self):
        """AssetStatsResponse schema 可正确序列化。"""
        from app.schemas.asset import AssetStatsResponse

        resp = AssetStatsResponse(
            total=100,
            by_type={"conversation": 60, "document": 40},
            recent_trend=[{"date": "2024-01-01", "count": 5}],
        )
        data = resp.model_dump()
        assert data["total"] == 100
        assert data["by_type"]["conversation"] == 60
