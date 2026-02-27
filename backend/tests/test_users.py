"""用户管理接口单元测试。"""

import pytest
from httpx import AsyncClient

from app.models.user import User


pytestmark = pytest.mark.asyncio


class TestGetMe:
    """GET /api/users/me 测试。"""

    async def test_get_me(self, authed_client: AsyncClient, test_user: User):
        """返回当前用户信息。"""
        resp = await authed_client.get("/api/users/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["feishu_open_id"] == test_user.feishu_open_id
        assert data["name"] == test_user.name
        assert data["role"] == "employee"


class TestListUsers:
    """GET /api/users 测试。"""

    async def test_admin_can_list(self, admin_client: AsyncClient, admin_user: User):
        """管理员可以获取用户列表。"""
        resp = await admin_client.get("/api/users")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    async def test_employee_cannot_list(self, authed_client: AsyncClient):
        """普通用户无法获取用户列表，返回 403。"""
        resp = await authed_client.get("/api/users")
        assert resp.status_code == 403


class TestUpdateRole:
    """PATCH /api/users/{feishu_open_id}/role 测试。"""

    async def test_admin_can_update_role(
        self, admin_client: AsyncClient, test_user: User
    ):
        """管理员可以修改用户角色。"""
        resp = await admin_client.patch(
            f"/api/users/{test_user.feishu_open_id}/role",
            json={"role": "executive"},
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "executive"

    async def test_employee_cannot_update_role(
        self, authed_client: AsyncClient, test_user: User
    ):
        """普通用户无法修改角色，返回 403。"""
        resp = await authed_client.patch(
            f"/api/users/{test_user.feishu_open_id}/role",
            json={"role": "admin"},
        )
        assert resp.status_code == 403

    async def test_update_nonexistent_user(self, admin_client: AsyncClient):
        """修改不存在用户返回 404。"""
        resp = await admin_client.patch(
            "/api/users/nonexistent_id/role",
            json={"role": "admin"},
        )
        assert resp.status_code == 404

    async def test_invalid_role(self, admin_client: AsyncClient, test_user: User):
        """无效角色返回 422。"""
        resp = await admin_client.patch(
            f"/api/users/{test_user.feishu_open_id}/role",
            json={"role": "superadmin"},
        )
        assert resp.status_code == 422
