"""ETL 管理接口单元测试。"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.services.etl.extractor import RegistryEntry

pytestmark = pytest.mark.asyncio


class TestETLStatus:
    """GET /api/etl/status 测试。"""

    async def test_admin_can_get_status(self, admin_client: AsyncClient):
        """管理员可以查看同步状态。"""
        resp = await admin_client.get("/api/etl/status")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_employee_cannot_get_status(self, authed_client: AsyncClient):
        """普通用户无法查看同步状态。"""
        resp = await authed_client.get("/api/etl/status")
        assert resp.status_code == 403


class TestETLTrigger:
    """POST /api/etl/trigger 测试。"""

    async def test_admin_can_trigger(self, admin_client: AsyncClient):
        """管理员可以手动触发 ETL。"""
        with (
            patch(
                "app.api.etl.registry_reader.read",
                new_callable=AsyncMock,
                return_value=[
                    RegistryEntry(app_token="app1", table_id="tbl1"),
                ],
            ),
            patch("app.api.etl.etl_sync_job", new_callable=AsyncMock),
        ):
            resp = await admin_client.post("/api/etl/trigger")

        assert resp.status_code == 200
        data = resp.json()
        assert data["sources_count"] == 1
        assert "已触发" in data["message"]

    async def test_employee_cannot_trigger(self, authed_client: AsyncClient):
        """普通用户无法触发 ETL。"""
        resp = await authed_client.post("/api/etl/trigger")
        assert resp.status_code == 403


class TestETLRegistry:
    """GET /api/etl/registry 测试。"""

    async def test_admin_can_view_registry(self, admin_client: AsyncClient):
        """管理员可以查看注册中心。"""
        mock_entries = [
            RegistryEntry(
                app_token="app1",
                table_id="tbl1",
                table_name="测试表",
                asset_type="conversation",
            ),
        ]

        with patch(
            "app.api.etl.registry_reader.read",
            new_callable=AsyncMock,
            return_value=mock_entries,
        ):
            resp = await admin_client.get("/api/etl/registry")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["app_token"] == "app1"

    async def test_employee_cannot_view_registry(self, authed_client: AsyncClient):
        """普通用户无法查看注册中心。"""
        resp = await authed_client.get("/api/etl/registry")
        assert resp.status_code == 403
