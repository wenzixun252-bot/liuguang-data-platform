"""飞书 API 客户端封装。"""

import asyncio
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

FEISHU_BASE_URL = "https://open.feishu.cn/open-apis"


class FeishuClient:
    """封装飞书开放平台 API 调用。"""

    def __init__(self) -> None:
        self._app_access_token: str | None = None
        self._tenant_access_token: str | None = None

    def _client(self) -> httpx.AsyncClient:
        """创建不走系统代理的 httpx 客户端。"""
        return httpx.AsyncClient(proxy=None, timeout=30.0)

    # ── 凭证获取 ───────────────────────────────────────────

    async def get_app_access_token(self) -> str:
        """获取应用凭证 (app_access_token)。"""
        async with self._client() as client:
            resp = await client.post(
                f"{FEISHU_BASE_URL}/auth/v3/app_access_token/internal",
                json={
                    "app_id": settings.feishu_app_id,
                    "app_secret": settings.feishu_app_secret,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取 app_access_token 失败: {data.get('msg', '未知错误')}"
                )
            self._app_access_token = data["app_access_token"]
            return self._app_access_token

    async def get_tenant_access_token(self) -> str:
        """获取企业凭证 (tenant_access_token)。"""
        async with self._client() as client:
            resp = await client.post(
                f"{FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal",
                json={
                    "app_id": settings.feishu_app_id,
                    "app_secret": settings.feishu_app_secret,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取 tenant_access_token 失败: {data.get('msg', '未知错误')}"
                )
            self._tenant_access_token = data["tenant_access_token"]
            return self._tenant_access_token

    # ── 用户信息 ───────────────────────────────────────────

    async def get_user_info_by_code(self, code: str) -> dict:
        """用临时授权码换取用户信息。

        Returns:
            包含 open_id, union_id, name, avatar_url, email 的字典。
        """
        app_access_token = await self.get_app_access_token()

        async with self._client() as client:
            # 1. 用 code 换取 user_access_token
            token_resp = await client.post(
                f"{FEISHU_BASE_URL}/authen/v1/oidc/access_token",
                headers={"Authorization": f"Bearer {app_access_token}"},
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                },
            )
            token_resp.raise_for_status()
            token_data = token_resp.json()
            if token_data.get("code") != 0:
                raise FeishuAPIError(
                    f"换取 user_access_token 失败: {token_data.get('msg', '未知错误')}"
                )
            user_access_token = token_data["data"]["access_token"]

            # 2. 用 user_access_token 获取用户信息
            user_resp = await client.get(
                f"{FEISHU_BASE_URL}/authen/v1/user_info",
                headers={"Authorization": f"Bearer {user_access_token}"},
            )
            user_resp.raise_for_status()
            user_data = user_resp.json()
            if user_data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取用户信息失败: {user_data.get('msg', '未知错误')}"
                )

            info = user_data["data"]
            return {
                "open_id": info["open_id"],
                "union_id": info.get("union_id", ""),
                "name": info["name"],
                "avatar_url": info.get("avatar_url", ""),
                "email": info.get("email", ""),
            }


    # ── 多维表格 (Bitable) API ──────────────────────────────

    async def list_bitable_records(
        self,
        app_token: str,
        table_id: str,
        filter_expr: str | None = None,
        page_token: str | None = None,
        page_size: int = 100,
    ) -> dict:
        """分页读取多维表格记录。

        Returns:
            {"items": [...], "page_token": "...", "has_more": bool, "total": int}
        """
        tenant_token = await self.get_tenant_access_token()

        params: dict = {"page_size": page_size}
        if filter_expr:
            params["filter"] = filter_expr
        if page_token:
            params["page_token"] = page_token

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/bitable/v1/apps/{app_token}/tables/{table_id}/records",
                headers={"Authorization": f"Bearer {tenant_token}"},
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"读取多维表格记录失败: {data.get('msg', '未知错误')}"
                )
            return data.get("data", {})

    async def get_bitable_fields(self, app_token: str, table_id: str) -> list[dict]:
        """获取表的字段 Schema 定义。"""
        tenant_token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/bitable/v1/apps/{app_token}/tables/{table_id}/fields",
                headers={"Authorization": f"Bearer {tenant_token}"},
                params={"page_size": 100},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取字段 Schema 失败: {data.get('msg', '未知错误')}"
                )
            return data.get("data", {}).get("items", [])

    async def get_bitable_tables(self, app_token: str) -> list[dict]:
        """获取应用下的所有表列表。"""
        tenant_token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/bitable/v1/apps/{app_token}/tables",
                headers={"Authorization": f"Bearer {tenant_token}"},
                params={"page_size": 100},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取表列表失败: {data.get('msg', '未知错误')}"
                )
            return data.get("data", {}).get("items", [])

    async def list_all_bitable_records(
        self,
        app_token: str,
        table_id: str,
        filter_expr: str | None = None,
    ) -> list[dict]:
        """自动分页获取全部记录，内置 QPS 控制。"""
        all_records: list[dict] = []
        page_token: str | None = None

        while True:
            data = await self.list_bitable_records(
                app_token, table_id, filter_expr=filter_expr, page_token=page_token
            )
            items = data.get("items", [])
            all_records.extend(items)
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
            # QPS 控制：≤ 5 请求/秒
            await asyncio.sleep(0.2)

        return all_records


class FeishuAPIError(Exception):
    """飞书 API 调用异常。"""


# 模块级单例
feishu_client = FeishuClient()
