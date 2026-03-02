"""飞书 API 客户端封装。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

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
            refresh_token = token_data["data"].get("refresh_token", "")

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
                "access_token": user_access_token,
                "refresh_token": refresh_token,
            }


    # ── 用户 Token 刷新 ────────────────────────────────────

    async def refresh_user_access_token(self, refresh_token: str) -> dict:
        """用 refresh_token 刷新 user_access_token。

        Returns:
            {"access_token": "...", "refresh_token": "...", "expires_in": ...}
        """
        app_access_token = await self.get_app_access_token()

        async with self._client() as client:
            resp = await client.post(
                f"{FEISHU_BASE_URL}/authen/v1/oidc/refresh_access_token",
                headers={"Authorization": f"Bearer {app_access_token}"},
                json={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"刷新 user_access_token 失败: {data.get('msg', '未知错误')}"
                )
            return data["data"]

    # ── 多维表格 (Bitable) API ──────────────────────────────

    async def list_bitable_records(
        self,
        app_token: str,
        table_id: str,
        filter_expr: str | None = None,
        page_token: str | None = None,
        page_size: int = 100,
        user_access_token: str | None = None,
    ) -> dict:
        """分页读取多维表格记录。

        Returns:
            {"items": [...], "page_token": "...", "has_more": bool, "total": int}
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        params: dict = {"page_size": page_size}
        if filter_expr:
            params["filter"] = filter_expr
        if page_token:
            params["page_token"] = page_token

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/bitable/v1/apps/{app_token}/tables/{table_id}/records",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"读取多维表格记录失败: {data.get('msg', '未知错误')}"
                )
            return data.get("data") or {}

    async def get_bitable_fields(self, app_token: str, table_id: str, user_access_token: str | None = None) -> list[dict]:
        """获取表的字段 Schema 定义。"""
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/bitable/v1/apps/{app_token}/tables/{table_id}/fields",
                headers={"Authorization": f"Bearer {token}"},
                params={"page_size": 100},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取字段 Schema 失败: {data.get('msg', '未知错误')}"
                )
            return data.get("data", {}).get("items", [])

    async def get_bitable_tables(self, app_token: str, user_access_token: str | None = None) -> list[dict]:
        """获取应用下的所有表列表。"""
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/bitable/v1/apps/{app_token}/tables",
                headers={"Authorization": f"Bearer {token}"},
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
        user_access_token: str | None = None,
    ) -> list[dict]:
        """自动分页获取全部记录，内置 QPS 控制。"""
        all_records: list[dict] = []
        page_token: str | None = None

        while True:
            data = await self.list_bitable_records(
                app_token, table_id, filter_expr=filter_expr, page_token=page_token,
                user_access_token=user_access_token,
            )
            items = data.get("items") or []
            all_records.extend(items)
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
            # QPS 控制：≤ 5 请求/秒
            await asyncio.sleep(0.2)

        return all_records


    # ── 云文档 Drive API ──────────────────────────────────────

    async def list_drive_bitables(self, user_access_token: str | None = None) -> list[dict]:
        """列出用户有权限访问的所有多维表格文件。

        优先使用 user_access_token（能看到用户自己的文件），
        回退到 tenant_access_token（只能看到分享给应用的文件）。

        调用 GET /open-apis/drive/v1/files，过滤 type=bitable，分页获取全部。
        返回: [{token, name, type, url, ...}]
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        all_files: list[dict] = []

        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {
                    "page_size": 50,
                }
                if page_token:
                    params["page_token"] = page_token

                resp = await client.get(
                    f"{FEISHU_BASE_URL}/drive/v1/files",
                    headers={"Authorization": f"Bearer {token}"},
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    raise FeishuAPIError(
                        f"获取云文档列表失败: {data.get('msg', '未知错误')}"
                    )

                items = data.get("data", {}).get("files", [])
                for item in items:
                    if item.get("type") == "bitable":
                        all_files.append(item)

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        return all_files

    # ── 文件下载 API ─────────────────────────────────────────

    async def download_media(self, file_token: str, user_access_token: str | None = None) -> bytes:
        """下载飞书附件/媒体文件。

        Args:
            file_token: 飞书文件 token
            user_access_token: 用户级 token（附件下载通常需要）

        Returns:
            文件二进制内容
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with httpx.AsyncClient(proxy=None, timeout=60.0) as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/drive/v1/medias/{file_token}/download",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.content

    # ── 通讯录 API ──────────────────────────────────────────

    async def get_department_list(self, parent_id: str = "0") -> list[dict]:
        """递归获取部门树。

        Returns:
            部门列表，每项包含 department_id, name, parent_department_id,
            leader_user_id, order 等。
        """
        tenant_token = await self.get_tenant_access_token()
        all_departments: list[dict] = []

        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {
                    "parent_department_id": parent_id,
                    "page_size": 50,
                    "fetch_child": "true",
                }
                if page_token:
                    params["page_token"] = page_token

                resp = await client.get(
                    f"{FEISHU_BASE_URL}/contact/v3/departments",
                    headers={"Authorization": f"Bearer {tenant_token}"},
                    params=params,
                )
                data = resp.json()
                if data.get("code") != 0:
                    raise FeishuAPIError(
                        f"获取部门列表失败 (code={data.get('code')}): {data.get('msg', '未知错误')}"
                    )

                items = data.get("data", {}).get("items", [])
                all_departments.extend(items)

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        # 检查是否缺少字段权限
        if all_departments and not all_departments[0].get("name"):
            raise FeishuAPIError(
                "飞书返回的部门数据缺少 name 字段，"
                "请在飞书开放平台为应用添加权限：contact:department.base:readonly "
                "（获取部门基础信息），添加后需要发布新版本并由管理员审批。"
            )

        return all_departments

    async def get_department_users(self, department_id: str) -> list[dict]:
        """获取部门下用户列表。

        Returns:
            用户列表，每项包含 open_id, name, department_ids 等。
        """
        tenant_token = await self.get_tenant_access_token()
        all_users: list[dict] = []

        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {
                    "department_id": department_id,
                    "page_size": 50,
                    "user_id_type": "open_id",
                    "department_id_type": "open_department_id",
                }
                if page_token:
                    params["page_token"] = page_token

                resp = await client.get(
                    f"{FEISHU_BASE_URL}/contact/v3/users",
                    headers={"Authorization": f"Bearer {tenant_token}"},
                    params=params,
                )
                data = resp.json()
                if data.get("code") != 0:
                    raise FeishuAPIError(
                        f"获取部门用户失败 (code={data.get('code')}): {data.get('msg', '未知错误')}"
                    )

                items = data.get("data", {}).get("items", [])
                all_users.extend(items)

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        return all_users


    # ── 任务 API ──────────────────────────────────────────

    async def create_task(
        self,
        title: str,
        description: str = "",
        due_date: datetime | None = None,
        user_access_token: str | None = None,
        user_open_id: str | None = None,
    ) -> str:
        """创建飞书任务。优先用 user_access_token，权限不足时自动降级到 tenant_access_token。
        降级时自动将用户加为任务负责人，确保任务出现在用户的飞书任务列表中。

        Returns:
            飞书任务 ID
        """
        body: dict = {
            "summary": title,
            "description": description,
        }
        if due_date:
            body["due"] = {
                "timestamp": str(int(due_date.timestamp())),
                "is_all_day": False,
            }

        # 如果用 user_access_token 创建，直接把自己设为负责人
        if user_open_id:
            body["members"] = [{"id": user_open_id, "type": "user", "role": "assignee"}]

        tokens_to_try = []
        if user_access_token:
            tokens_to_try.append(("user", user_access_token))
        tokens_to_try.append(("tenant", None))

        last_error = None
        for token_type, token in tokens_to_try:
            if token is None:
                token = await self.get_tenant_access_token()

            async with self._client() as client:
                try:
                    resp = await client.post(
                        f"{FEISHU_BASE_URL}/task/v2/tasks",
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json; charset=utf-8",
                        },
                        json=body,
                    )
                    resp.raise_for_status()
                except httpx.HTTPStatusError as e:
                    last_error = FeishuAPIError(
                        f"创建飞书任务HTTP错误 ({e.response.status_code}): {e.response.text[:200]}"
                    )
                    if token_type == "user":
                        logger.warning("user_access_token 创建任务失败，降级到 tenant_access_token")
                        continue
                    raise last_error from e

                data = resp.json()
                code = data.get("code", -1)
                if code == 0:
                    task_guid = data.get("data", {}).get("task", {}).get("guid", "")
                    return task_guid

                if code in (99991679, 99991668, 99991672) and token_type == "user":
                    logger.warning("user_access_token 权限不足 (code=%s)，降级到 tenant_access_token", code)
                    continue

                last_error = FeishuAPIError(f"创建飞书任务失败 (code={code}): {data.get('msg', '未知错误')}")
                if token_type == "user":
                    continue
                raise last_error

        raise last_error or FeishuAPIError("创建飞书任务失败: 未知错误")

    # ── 云文档 API ──────────────────────────────────────────

    async def create_document(
        self,
        title: str,
        content: str = "",
        user_access_token: str | None = None,
        user_open_id: str | None = None,
    ) -> dict:
        """创建飞书云文档并写入内容。

        必须使用 user_access_token 创建文档，以确保文档作者是用户本人。
        如果 user_access_token 权限不足，抛出明确错误要求重新登录。

        Returns:
            {"document_id": "...", "url": "..."}
        """
        if not user_access_token:
            raise FeishuAPIError("创建文档需要用户授权，请重新登录获取文档写入权限")

        token = user_access_token

        async with self._client() as client:
            # 1. 创建文档
            try:
                create_resp = await client.post(
                    f"{FEISHU_BASE_URL}/docx/v1/documents",
                    headers={"Authorization": f"Bearer {token}"},
                    json={"title": title},
                )
                create_resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                err_text = e.response.text[:200]
                logger.error("创建飞书文档HTTP错误: %s", err_text)
                raise FeishuAPIError(
                    "创建文档失败，您的飞书授权可能缺少文档写入权限，请退出登录后重新登录"
                ) from e

            create_data = create_resp.json()
            code = create_data.get("code", -1)
            if code != 0:
                msg = create_data.get("msg", "未知错误")
                logger.error("创建飞书文档失败 (code=%s): %s", code, msg)
                if code in (99991679, 99991668, 99991672):
                    raise FeishuAPIError(
                        "您的飞书授权缺少文档写入权限(docx:document:write)，请退出登录后重新登录"
                    )
                raise FeishuAPIError(f"创建飞书文档失败: {msg}")

            doc_info = create_data.get("data", {}).get("document", {})
            document_id = doc_info.get("document_id", "")

            # 2. 写入内容（批量写入，每批最多 50 个 block）
            if content and document_id:
                blocks = self._markdown_to_feishu_blocks(content)
                batch_size = 50
                for i in range(0, len(blocks), batch_size):
                    batch = blocks[i:i + batch_size]
                    try:
                        resp_block = await client.post(
                            f"{FEISHU_BASE_URL}/docx/v1/documents/{document_id}/blocks/{document_id}/children",
                            headers={"Authorization": f"Bearer {token}"},
                            json={"children": batch},
                        )
                        block_data = resp_block.json()
                        if block_data.get("code") != 0:
                            logger.warning(
                                "写入文档 block 失败 (code=%s): %s",
                                block_data.get("code"), block_data.get("msg"),
                            )
                    except Exception as e:
                        logger.warning("写入文档 block 异常: %s", e)

            return {
                "document_id": document_id,
                "url": f"https://feishu.cn/docx/{document_id}",
            }

    @staticmethod
    def _markdown_to_feishu_blocks(markdown_text: str) -> list[dict]:
        """将 Markdown 文本转换为飞书文档 Block 结构。

        经验证仅 text(2) 和 heading(3/4/5) block 可稳定写入，
        其他类型（bullet/ordered/code/quote）API 返回 invalid param，
        因此统一用 text block 承载，保留原始 Markdown 符号。
        """
        blocks = []
        lines = markdown_text.split("\n")

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # 处理 Markdown 加粗：**text** → 保留原文（飞书会原样显示）
            if stripped.startswith("#### "):
                blocks.append({
                    "block_type": 5,  # heading3（飞书 heading 最多3级，####映射到h3）
                    "heading3": {
                        "elements": [{"text_run": {"content": stripped[5:]}}],
                    },
                })
            elif stripped.startswith("### "):
                blocks.append({
                    "block_type": 5,  # heading3
                    "heading3": {
                        "elements": [{"text_run": {"content": stripped[4:]}}],
                    },
                })
            elif stripped.startswith("## "):
                blocks.append({
                    "block_type": 4,  # heading2
                    "heading2": {
                        "elements": [{"text_run": {"content": stripped[3:]}}],
                    },
                })
            elif stripped.startswith("# "):
                blocks.append({
                    "block_type": 3,  # heading1
                    "heading1": {
                        "elements": [{"text_run": {"content": stripped[2:]}}],
                    },
                })
            elif stripped == "---" or stripped == "***":
                # 分隔线 → 用横线文本模拟
                blocks.append({
                    "block_type": 2,
                    "text": {
                        "elements": [{"text_run": {"content": "————————————————————————"}}],
                    },
                })
            else:
                # 所有其他内容统一为 text block，保留原始格式符号
                blocks.append({
                    "block_type": 2,  # text
                    "text": {
                        "elements": [{"text_run": {"content": stripped}}],
                    },
                })

        return blocks


class FeishuAPIError(Exception):
    """飞书 API 调用异常。"""


# 模块级单例
feishu_client = FeishuClient()
