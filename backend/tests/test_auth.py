"""鉴权接口单元测试。"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.models.user import User


pytestmark = pytest.mark.asyncio


class TestFeishuCallback:
    """POST /api/auth/feishu/callback 测试。"""

    async def test_callback_new_user(self, client: AsyncClient):
        """新用户首次登录，创建用户并返回 JWT。"""
        mock_user_info = {
            "open_id": "new_user_open_id",
            "union_id": "new_user_union_id",
            "name": "新用户",
            "avatar_url": "https://example.com/avatar.png",
            "email": "new@example.com",
        }

        with patch(
            "app.api.auth.feishu_client.get_user_info_by_code",
            new_callable=AsyncMock,
            return_value=mock_user_info,
        ):
            resp = await client.post(
                "/api/auth/feishu/callback",
                json={"code": "mock_code_123"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["feishu_open_id"] == "new_user_open_id"
        assert data["user"]["name"] == "新用户"
        assert data["user"]["role"] == "employee"

    async def test_callback_existing_user(self, client: AsyncClient, test_user: User):
        """已有用户登录，更新信息并返回 JWT。"""
        mock_user_info = {
            "open_id": test_user.feishu_open_id,
            "union_id": test_user.feishu_union_id,
            "name": "更新后的名字",
            "avatar_url": "https://example.com/new_avatar.png",
            "email": test_user.email,
        }

        with patch(
            "app.api.auth.feishu_client.get_user_info_by_code",
            new_callable=AsyncMock,
            return_value=mock_user_info,
        ):
            resp = await client.post(
                "/api/auth/feishu/callback",
                json={"code": "mock_code_456"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["name"] == "更新后的名字"

    async def test_callback_feishu_api_error(self, client: AsyncClient):
        """飞书 API 调用失败返回 502。"""
        from app.services.feishu import FeishuAPIError

        with patch(
            "app.api.auth.feishu_client.get_user_info_by_code",
            new_callable=AsyncMock,
            side_effect=FeishuAPIError("获取 user_access_token 失败: invalid code"),
        ):
            resp = await client.post(
                "/api/auth/feishu/callback",
                json={"code": "bad_code"},
            )

        assert resp.status_code == 502
        assert "飞书认证失败" in resp.json()["detail"]

    async def test_callback_missing_code(self, client: AsyncClient):
        """缺少 code 参数返回 422。"""
        resp = await client.post("/api/auth/feishu/callback", json={})
        assert resp.status_code == 422


class TestGetCurrentUser:
    """get_current_user 依赖注入测试。"""

    async def test_valid_token(self, authed_client: AsyncClient):
        """合法 token 返回用户信息。"""
        resp = await authed_client.get("/api/users/me")
        assert resp.status_code == 200
        assert resp.json()["feishu_open_id"] == "test_open_id_001"

    async def test_missing_token(self, client: AsyncClient):
        """无 token 返回 401。"""
        resp = await client.get("/api/users/me")
        assert resp.status_code in (401, 403)

    async def test_invalid_token(self, client: AsyncClient):
        """无效 token 返回 401。"""
        resp = await client.get(
            "/api/users/me",
            headers={"Authorization": "Bearer invalid_token"},
        )
        assert resp.status_code == 401
