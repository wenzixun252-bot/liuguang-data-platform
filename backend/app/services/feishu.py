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
        # 缓存 {user_access_token -> calendar_id}，避免每次请求都查日历列表
        self._calendar_id_cache: dict[str, str] = {}

    def _client(self) -> httpx.AsyncClient:
        """创建不走系统代理的 httpx 客户端。"""
        return httpx.AsyncClient(proxy=None, timeout=30.0, verify=False)

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

    async def list_drive_documents(self, user_access_token: str | None = None) -> list[dict]:
        """列出用户有权限访问的云文档和文件（docx/doc/file 类型）。

        返回: [{token, name, type, url, created_time, modified_time, ...}]
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        supported_types = {"docx", "doc", "file"}
        all_files: list[dict] = []

        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {"page_size": 50, "user_id_type": "open_id"}
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
                    if item.get("type") in supported_types:
                        all_files.append(item)

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        return all_files

    async def search_accessible_docs(
        self,
        keyword: str,
        user_access_token: str,
        doc_types: list[str] | None = None,
        max_count: int = 200,
    ) -> list[dict]:
        """搜索用户有权限访问的全部文档（含他人分享），按关键词匹配文档名/内容。

        使用 POST /open-apis/suite/docs-api/search/object，
        该 API 会搜索用户所有可访问空间（自己的 + 他人分享的 + 知识空间）。

        返回: [{token, name, type, owner_id, url, ...}]  统一与 list_drive_documents 格式一致
        """
        if doc_types is None:
            doc_types = ["doc", "docx"]

        all_docs: list[dict] = []
        offset = 0
        page_size = min(50, max_count)

        async with self._client() as client:
            while len(all_docs) < max_count:
                body: dict = {
                    "search_key": keyword,
                    "count": page_size,
                    "offset": offset,
                    "docs_types": doc_types,
                }
                resp = await client.post(
                    f"{FEISHU_BASE_URL}/suite/docs-api/search/object",
                    headers={"Authorization": f"Bearer {user_access_token}"},
                    json=body,
                )
                if resp.status_code == 401:
                    raise FeishuAPIError("用户 Token 已过期 (401 Unauthorized)")
                resp.raise_for_status()
                data = resp.json()

                if data.get("code") != 0:
                    raise FeishuAPIError(
                        f"搜索文档失败: {data.get('msg', '未知错误')} (code={data.get('code')})"
                    )

                entities = data.get("data", {}).get("docs_entities") or []
                if entities:
                    logger.info("搜索原始返回示例 keys=%s, sample=%s", list(entities[0].keys()), entities[0])
                for entity in entities:
                    # docs_token 是该 API 的实际 token 字段
                    tok = entity.get("docs_token") or entity.get("token") or ""
                    # 飞书搜索 API 返回的类型字段是 docs_type（带 s）
                    raw_type = entity.get("docs_type") or entity.get("doc_type") or "docx"
                    all_docs.append({
                        "token": tok,
                        "name": entity.get("title", ""),
                        "type": raw_type,
                        "owner_id": entity.get("owner_id", ""),
                        "owner_name": entity.get("owner_name", ""),
                        "url": entity.get("url", ""),
                        "create_time": entity.get("create_time"),
                        "_source": "search",
                    })

                has_more = data.get("data", {}).get("has_more", False)
                if not has_more or not entities:
                    break

                offset += len(entities)
                await asyncio.sleep(0.3)

        logger.info("飞书搜索「%s」返回 %d 个文档", keyword, len(all_docs))
        return all_docs

    async def batch_get_doc_meta(
        self,
        docs: list[dict],
        user_access_token: str | None = None,
    ) -> dict[str, dict]:
        """批量获取文档元数据（create_time, url, owner_name 等）。

        使用 POST /open-apis/drive/v1/metas/batch_query
        docs: [{token, type}] — 每个元素需要 token 和 type 字段
        返回: {token: {url, create_time, owner_name}} 的字典

        优先使用 user_access_token，如果失败则自动回退到 tenant_access_token。
        """
        result: dict[str, dict] = {}
        batch_size = 200

        # 准备 token 列表：优先用户 token，兜底 tenant token
        tokens_to_try = []
        if user_access_token:
            tokens_to_try.append(user_access_token)
        tenant_token = await self.get_tenant_access_token()
        if tenant_token:
            tokens_to_try.append(tenant_token)
        if not tokens_to_try:
            logger.warning("batch_get_doc_meta: 无可用 token")
            return result

        async with self._client() as client:
            for i in range(0, len(docs), batch_size):
                batch = docs[i:i + batch_size]
                request_docs = []
                for d in batch:
                    raw_type = d.get("type", "docx")
                    request_docs.append({
                        "doc_token": d["token"],
                        "doc_type": raw_type,
                    })

                # 尝试每个 token，直到成功
                for access_token in tokens_to_try:
                    resp = await client.post(
                        f"{FEISHU_BASE_URL}/drive/v1/metas/batch_query",
                        headers={"Authorization": f"Bearer {access_token}"},
                        json={"request_docs": request_docs},
                        params={"user_id_type": "open_id"},
                    )
                    if resp.status_code != 200:
                        logger.warning("batch_get_doc_meta HTTP %s", resp.status_code)
                        continue
                    data = resp.json()
                    if data.get("code") != 0:
                        logger.warning("batch_get_doc_meta error: code=%s msg=%s", data.get("code"), data.get("msg"))
                        continue
                    # 成功，解析结果
                    metas = data.get("data", {}).get("metas") or []
                    failed = data.get("data", {}).get("failed_list") or []
                    if failed:
                        logger.debug("batch_get_doc_meta %d failed", len(failed))

                    for m in metas:
                        tok = m.get("doc_token", "")
                        # 记录原始响应 keys 以便调试 owner 字段
                        if metas and not result:
                            logger.debug("batch_get_doc_meta 响应字段: %s", list(m.keys()))
                        result[tok] = {
                            "url": m.get("url", ""),
                            "title": m.get("title", ""),
                            "create_time": m.get("create_time"),
                            "latest_modify_time": m.get("latest_modify_time"),
                            "owner_id": m.get("owner_id", ""),
                            "owner_name": m.get("owner_display_name", ""),
                        }
                    break  # 成功了就不再尝试下一个 token

                if i + batch_size < len(docs):
                    await asyncio.sleep(0.3)

        logger.info("batch_get_doc_meta: 查询 %d, 成功 %d", len(docs), len(result))
        return result

    async def list_folder_files(
        self,
        folder_token: str,
        user_access_token: str | None = None,
    ) -> list[dict]:
        """列出指定文件夹下的所有文件，包括快捷方式指向的原始文档。

        Args:
            folder_token: 飞书文件夹 token（可从文件夹 URL 获取）

        返回: [{token, name, type, created_time, modified_time, ...}]
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        supported_types = {"docx", "doc", "file"}
        all_files: list[dict] = []

        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {
                    "page_size": 50,
                    "folder_token": folder_token,
                    "user_id_type": "open_id",
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
                        f"获取文件夹文件列表失败: {data.get('msg', '未知错误')}"
                    )

                items = data.get("data", {}).get("files", [])
                for item in items:
                    file_type = item.get("type")
                    if file_type in supported_types:
                        all_files.append(item)
                    elif file_type == "shortcut":
                        # 快捷方式：解析为原始文件
                        shortcut_info = item.get("shortcut_info", {})
                        target_type = shortcut_info.get("target_type")
                        target_token = shortcut_info.get("target_token")
                        if target_type in supported_types and target_token:
                            resolved = {
                                **item,
                                "token": target_token,
                                "type": target_type,
                                "_from_shortcut": True,
                            }
                            all_files.append(resolved)
                            logger.debug(
                                "快捷方式 %s -> %s (%s)",
                                item.get("name"), target_token, target_type,
                            )

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        return all_files

    async def list_root_folders(
        self,
        user_access_token: str | None = None,
    ) -> list[dict]:
        """列出用户云空间根目录下的所有文件夹。

        返回: [{token, name, type: "folder"}]
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        folders: list[dict] = []
        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {"page_size": 50, "folder_token": ""}
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
                    break

                items = data.get("data", {}).get("files", [])
                for item in items:
                    if item.get("type") == "folder":
                        folders.append({
                            "token": item.get("token", ""),
                            "name": item.get("name", ""),
                            "type": "folder",
                        })

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        return folders

    async def get_document_content(
        self,
        document_id: str,
        user_access_token: str | None = None,
    ) -> dict:
        """获取飞书云文档的完整内容（通过 Block API）。

        Args:
            document_id: 飞书文档 ID

        Returns:
            {"title": "...", "content_text": "...", "created_time": ..., "modified_time": ...}
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with self._client() as client:
            # 1. 获取文档元数据
            meta_resp = await client.get(
                f"{FEISHU_BASE_URL}/docx/v1/documents/{document_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            meta_resp.raise_for_status()
            meta_data = meta_resp.json()
            if meta_data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取文档元数据失败: {meta_data.get('msg', '未知错误')}"
                )
            doc_info = meta_data.get("data", {}).get("document", {})
            title = doc_info.get("title", "")
            created_time = doc_info.get("create_time")
            modified_time = doc_info.get("modify_time")

            # 2. 获取所有 block（分页）
            all_blocks: list[dict] = []
            page_token: str | None = None
            while True:
                params: dict = {"page_size": 500, "document_revision_id": -1}
                if page_token:
                    params["page_token"] = page_token

                blocks_resp = await client.get(
                    f"{FEISHU_BASE_URL}/docx/v1/documents/{document_id}/blocks",
                    headers={"Authorization": f"Bearer {token}"},
                    params=params,
                )
                blocks_resp.raise_for_status()
                blocks_data = blocks_resp.json()
                if blocks_data.get("code") != 0:
                    raise FeishuAPIError(
                        f"获取文档 blocks 失败: {blocks_data.get('msg', '未知错误')}"
                    )

                items = blocks_data.get("data", {}).get("items", [])
                all_blocks.extend(items)

                if not blocks_data.get("data", {}).get("has_more"):
                    break
                page_token = blocks_data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        content_text = self._blocks_to_text(all_blocks)
        return {
            "title": title,
            "content_text": content_text,
            "created_time": created_time,
            "modified_time": modified_time,
        }

    @staticmethod
    def _blocks_to_text(blocks: list[dict]) -> str:
        """将飞书文档 Block 列表转换为 Markdown 风格纯文本。

        支持的 block 类型:
        1=page, 2=text, 3=heading1, 4=heading2, 5=heading3,
        6=heading4, 7=heading5, 8=heading6,
        9=bullet, 10=ordered, 11=code, 12=quote_container,
        14=todo, 17=divider, 18=table, 27=image, 23=callout
        """
        lines: list[str] = []
        ordered_counter = 0

        # 构建 block_id -> block 的索引，以及 child_id -> parent_block 的映射
        block_map: dict[str, dict] = {}
        parent_map: dict[str, dict] = {}
        for block in blocks:
            bid = block.get("block_id", "")
            if bid:
                block_map[bid] = block
            for child_id in block.get("children", []):
                parent_map[child_id] = block

        def _is_inside_container(block: dict) -> bool:
            """判断 block 是否在 quote_container(12) 或 callout(23) 内部。"""
            bid = block.get("block_id", "")
            parent = parent_map.get(bid)
            if parent and parent.get("block_type") in (12, 23):
                return True
            return False

        for block in blocks:
            block_type = block.get("block_type", 0)

            # 跳过 page 根 block
            if block_type == 1:
                continue

            # 提取 text elements 的辅助逻辑
            def _extract_text(key: str) -> str:
                elements = block.get(key, {}).get("elements", [])
                parts = []
                for el in elements:
                    text_run = el.get("text_run")
                    if text_run:
                        parts.append(text_run.get("content", ""))
                    mention_user = el.get("mention_user")
                    if mention_user:
                        parts.append(f"@{mention_user.get('user_id', '用户')}")
                    mention_doc = el.get("mention_doc")
                    if mention_doc:
                        parts.append(f"[文档: {mention_doc.get('title', '')}]")
                return "".join(parts)

            # quote_container(12) 和 callout(23) 是容器块，
            # 它们本身没有文字，文字在子块中，跳过容器本身
            if block_type in (12, 23):
                ordered_counter = 0
                continue

            # 判断当前 block 是否在 quote/callout 容器内，是则加 "> " 前缀
            prefix = "> " if _is_inside_container(block) else ""

            if block_type == 2:  # text
                text = _extract_text("text")
                if text.strip():
                    lines.append(f"{prefix}{text}")
                    ordered_counter = 0
                else:
                    lines.append(f"{prefix}" if prefix else "")
                    ordered_counter = 0

            elif block_type == 3:  # heading1
                lines.append(f"{prefix}# {_extract_text('heading1')}")
                ordered_counter = 0
            elif block_type == 4:  # heading2
                lines.append(f"{prefix}## {_extract_text('heading2')}")
                ordered_counter = 0
            elif block_type == 5:  # heading3
                lines.append(f"{prefix}### {_extract_text('heading3')}")
                ordered_counter = 0
            elif block_type in (6, 7, 8):  # heading4-6
                key = f"heading{block_type - 3}"
                lines.append(f"{prefix}{'#' * (block_type - 3)} {_extract_text(key)}")
                ordered_counter = 0

            elif block_type == 9:  # bullet
                lines.append(f"{prefix}- {_extract_text('bullet')}")
                ordered_counter = 0
            elif block_type == 10:  # ordered
                ordered_counter += 1
                lines.append(f"{prefix}{ordered_counter}. {_extract_text('ordered')}")

            elif block_type == 11:  # code
                code_text = _extract_text("code")
                lang = block.get("code", {}).get("style", {}).get("language", "")
                lines.append(f"{prefix}```{lang}")
                lines.append(f"{prefix}{code_text}")
                lines.append(f"{prefix}```")
                ordered_counter = 0

            elif block_type == 14:  # todo
                done = block.get("todo", {}).get("style", {}).get("done", False)
                mark = "[x]" if done else "[ ]"
                lines.append(f"{prefix}- {mark} {_extract_text('todo')}")
                ordered_counter = 0

            elif block_type == 17:  # divider
                lines.append(f"{prefix}---")
                ordered_counter = 0

            elif block_type == 27:  # image
                lines.append(f"{prefix}[图片]")
                ordered_counter = 0

            elif block_type == 18:  # table
                lines.append(f"{prefix}[表格]")
                ordered_counter = 0

            else:
                # 其他未知 block 类型，静默跳过
                ordered_counter = 0

        return "\n".join(lines)

    # ── 文件下载 API ─────────────────────────────────────────

    async def download_media(self, file_token: str, user_access_token: str | None = None) -> bytes:
        """下载飞书附件/媒体文件（多维表格附件等素材）。

        调用: GET /drive/v1/medias/{file_token}/download
        适用于 Bitable 附件等素材资源。

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

        async with httpx.AsyncClient(proxy=None, timeout=60.0, verify=False) as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/drive/v1/medias/{file_token}/download",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.content

    async def download_message_resource(
        self, message_id: str, file_key: str, resource_type: str = "file"
    ) -> bytes:
        """下载飞书消息中的文件或图片资源。

        调用: GET /im/v1/messages/{message_id}/resources/{file_key}?type={type}
        适用于用户通过消息发送的文件、图片。

        Args:
            message_id: 消息 ID
            file_key: 文件 key 或 image_key
            resource_type: "file" 或 "image"
        """
        token = await self.get_tenant_access_token()
        async with httpx.AsyncClient(proxy=None, timeout=60.0, verify=False) as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/im/v1/messages/{message_id}/resources/{file_key}",
                params={"type": resource_type},
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.content

    async def download_drive_file(self, file_token: str, user_access_token: str | None = None) -> bytes:
        """下载飞书云空间中的文件（PDF/PPT/DOCX 等上传到 Drive 的文件）。

        调用: GET /drive/v1/files/{file_token}/download
        适用于 Drive 中 type='file' 的文件（不适用于 docx/sheet 等云文档）。

        Args:
            file_token: 飞书文件 token
            user_access_token: 用户级 token

        Returns:
            文件二进制内容
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with httpx.AsyncClient(proxy=None, timeout=120.0, verify=False) as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/drive/v1/files/{file_token}/download",
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


    # ── 用户名批量解析 ─────────────────────────────────────

    async def batch_get_user_names(
        self,
        open_ids: list[str],
    ) -> dict[str, str]:
        """通过飞书 Contact API 批量获取用户显示名（用 tenant_access_token）。

        Args:
            open_ids: 用户 open_id 列表

        Returns:
            {open_id: display_name} 字典，查不到的不会出现在结果中
        """
        if not open_ids:
            return {}

        result: dict[str, str] = {}
        tenant_token = await self.get_tenant_access_token()
        if not tenant_token:
            logger.warning("batch_get_user_names: 无法获取 tenant_access_token")
            return result

        async with self._client() as client:
            for oid in open_ids:
                try:
                    resp = await client.get(
                        f"{FEISHU_BASE_URL}/contact/v3/users/{oid}",
                        headers={"Authorization": f"Bearer {tenant_token}"},
                        params={"user_id_type": "open_id"},
                    )
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    if data.get("code") != 0:
                        continue
                    user_info = data.get("data", {}).get("user", {})
                    name = user_info.get("name", "")
                    if name:
                        result[oid] = name
                except Exception:
                    continue
                await asyncio.sleep(0.1)

        logger.info("batch_get_user_names: 查询 %d, 解析 %d", len(open_ids), len(result))
        return result

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

    async def get_task_detail(
        self,
        task_id: str,
        user_access_token: str | None = None,
    ) -> dict | None:
        """获取飞书任务详情，返回任务数据（含完成状态）。

        Returns:
            任务详情 dict，失败返回 None
        """
        token = user_access_token
        if not token:
            token = await self.get_tenant_access_token()

        async with self._client() as client:
            try:
                resp = await client.get(
                    f"{FEISHU_BASE_URL}/task/v2/tasks/{task_id}",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json; charset=utf-8",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0:
                    return data.get("data", {}).get("task")
                logger.warning("获取飞书任务 %s 失败: code=%s", task_id, data.get("code"))
                return None
            except Exception as e:
                logger.warning("获取飞书任务 %s 异常: %s", task_id, e)
                return None


    # ── 飞书表格 (Spreadsheet) API ────────────────────────────

    async def get_spreadsheet_meta(self, spreadsheet_token: str, user_access_token: str | None = None) -> dict:
        """获取飞书表格元信息（名称等）。

        GET /open-apis/sheets/v3/spreadsheets/{token}
        返回: {title, owner_id, url, ...}
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/sheets/v3/spreadsheets/{spreadsheet_token}",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取飞书表格元信息失败: {data.get('msg', '未知错误')}"
                )
            return data.get("data", {}).get("spreadsheet", {})

    async def get_spreadsheet_sheets(self, spreadsheet_token: str, user_access_token: str | None = None) -> list[dict]:
        """获取飞书表格下的所有工作表。

        GET /open-apis/sheets/v3/spreadsheets/{token}/sheets/query
        返回: [{sheet_id, title, row_count, column_count}, ...]
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/sheets/v3/spreadsheets/{spreadsheet_token}/sheets/query",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取工作表列表失败: {data.get('msg', '未知错误')}"
                )
            return data.get("data", {}).get("sheets", [])

    async def get_spreadsheet_values(self, spreadsheet_token: str, sheet_range: str, user_access_token: str | None = None) -> list[list]:
        """读取飞书表格指定范围的数据。

        GET /open-apis/sheets/v2/spreadsheets/{token}/values/{range}
        range 格式: "SheetName!A1:Z1000"
        返回: 二维数组 [[行1值...], [行2值...], ...]
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/sheets/v2/spreadsheets/{spreadsheet_token}/values/{sheet_range}",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise FeishuAPIError(
                    f"读取飞书表格数据失败: {data.get('msg', '未知错误')}"
                )
            value_range = data.get("data", {}).get("valueRange", {})
            return value_range.get("values", [])

    async def list_drive_spreadsheets(self, user_access_token: str | None = None) -> list[dict]:
        """列出用户有权限访问的所有飞书表格（sheet 类型）文件。

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
                params: dict = {"page_size": 50}
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
                    if item.get("type") == "sheet":
                        all_files.append(item)

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        return all_files


    # ── 知识空间 (Wiki) API ──────────────────────────────────

    async def get_wiki_node_info(self, node_token: str, user_access_token: str | None = None) -> dict:
        """根据 wiki node_token 获取节点信息，解析出实际的 obj_token 和 obj_type。

        GET /open-apis/wiki/v2/spaces/get_node?token={node_token}
        返回: {node_token, obj_token, obj_type, title, space_id, ...}
        obj_token 就是多维表格的 app_token 或飞书表格的 spreadsheet_token。
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.get(
                f"{FEISHU_BASE_URL}/wiki/v2/spaces/get_node",
                headers={"Authorization": f"Bearer {token}"},
                params={"token": node_token},
            )
            data = resp.json()
            logger.info("get_wiki_node_info 响应: status=%s, code=%s, msg=%s",
                        resp.status_code, data.get("code"), data.get("msg"))
            if resp.status_code != 200 or data.get("code") != 0:
                raise FeishuAPIError(
                    f"获取 Wiki 节点信息失败 (HTTP {resp.status_code}): {data.get('msg', '未知错误')}"
                )
            return data.get("data", {}).get("node", {})

    async def list_wiki_spaces(self, user_access_token: str | None = None) -> list[dict]:
        """列出用户有权限访问的所有知识空间。

        GET /open-apis/wiki/v2/spaces
        返回: [{space_id, name, description, ...}]
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        all_spaces: list[dict] = []

        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {"page_size": 50}
                if page_token:
                    params["page_token"] = page_token

                resp = await client.get(
                    f"{FEISHU_BASE_URL}/wiki/v2/spaces",
                    headers={"Authorization": f"Bearer {token}"},
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    raise FeishuAPIError(
                        f"获取知识空间列表失败: {data.get('msg', '未知错误')}"
                    )

                items = data.get("data", {}).get("items", [])
                all_spaces.extend(items)

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        return all_spaces

    async def list_wiki_nodes(
        self,
        space_id: str,
        parent_node_token: str | None = None,
        user_access_token: str | None = None,
    ) -> list[dict]:
        """列出知识空间下的节点（递归获取第一层）。

        GET /open-apis/wiki/v2/spaces/{space_id}/nodes
        每个节点包含: {node_token, obj_token, obj_type, title, ...}
        obj_type 可能是: "doc"/"docx"/"sheet"/"bitable"/"file" 等
        """
        if user_access_token:
            token = user_access_token
        else:
            token = await self.get_tenant_access_token()

        all_nodes: list[dict] = []

        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {"page_size": 50}
                if page_token:
                    params["page_token"] = page_token
                if parent_node_token:
                    params["parent_node_token"] = parent_node_token

                resp = await client.get(
                    f"{FEISHU_BASE_URL}/wiki/v2/spaces/{space_id}/nodes",
                    headers={"Authorization": f"Bearer {token}"},
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    raise FeishuAPIError(
                        f"获取知识空间节点失败: {data.get('msg', '未知错误')}"
                    )

                items = data.get("data", {}).get("items", [])
                all_nodes.extend(items)

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.2)

        return all_nodes

    async def list_wiki_nodes_by_type(
        self,
        obj_types: set[str],
        user_access_token: str | None = None,
    ) -> list[dict]:
        """从所有知识空间中收集指定类型的节点。

        Args:
            obj_types: 要筛选的类型集合，如 {"bitable", "sheet"}

        返回: [{obj_token, title, obj_type, space_name, ...}]
        """
        results: list[dict] = []
        try:
            spaces = await self.list_wiki_spaces(user_access_token)
        except FeishuAPIError as e:
            logger.warning("获取知识空间列表失败（可能缺少权限）: %s", e)
            return results

        for space in spaces:
            space_id = space.get("space_id", "")
            space_name = space.get("name", "")
            try:
                nodes = await self.list_wiki_nodes(space_id, user_access_token=user_access_token)
                for node in nodes:
                    if node.get("obj_type") in obj_types:
                        node["space_name"] = space_name
                        results.append(node)
            except FeishuAPIError as e:
                logger.warning("获取知识空间 %s 节点失败: %s", space_name, e)
                continue

        return results


    # ── 日历 (Calendar) API ──────────────────────────────────

    async def _get_primary_calendar_id(self, client: httpx.AsyncClient, user_access_token: str) -> str:
        """获取用户主日历的 calendar_id（带内存缓存）。"""
        # 命中缓存直接返回
        cached = self._calendar_id_cache.get(user_access_token)
        if cached:
            return cached

        resp = await client.get(
            f"{FEISHU_BASE_URL}/calendar/v4/calendars",
            headers={"Authorization": f"Bearer {user_access_token}"},
            params={"page_size": 50},
        )
        if resp.status_code != 200:
            logger.error("获取日历列表 HTTP错误 status=%s body=%s", resp.status_code, resp.text[:500])
            raise FeishuAPIError(f"HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        if data.get("code") != 0:
            raise FeishuAPIError(f"获取日历列表失败: code={data.get('code')} msg={data.get('msg', '未知错误')}")

        calendars = data.get("data", {}).get("calendar_list", [])
        logger.info("获取到 %d 个日历", len(calendars))
        for cal in calendars:
            logger.debug("日历: id=%s type=%s role=%s summary=%s",
                         cal.get("calendar_id"), cal.get("type"), cal.get("role"), cal.get("summary", ""))

        # 优先找 type=primary 的日历
        for cal in calendars:
            if cal.get("type") == "primary":
                cal_id = cal["calendar_id"]
                self._calendar_id_cache[user_access_token] = cal_id
                return cal_id
        # 其次找 role=owner 的日历
        for cal in calendars:
            if cal.get("role") == "owner":
                cal_id = cal["calendar_id"]
                self._calendar_id_cache[user_access_token] = cal_id
                return cal_id
        # 兜底：返回第一个日历
        if calendars:
            cal_id = calendars[0]["calendar_id"]
            logger.warning("未找到 primary 日历，使用第一个: %s", cal_id)
            self._calendar_id_cache[user_access_token] = cal_id
            return cal_id
        raise FeishuAPIError("未找到用户日历")

    def invalidate_calendar_cache(self, user_access_token: str) -> None:
        """当 token 刷新后，清除旧 token 对应的日历缓存。"""
        self._calendar_id_cache.pop(user_access_token, None)

    async def get_calendar_events(
        self,
        user_access_token: str,
        start_time: datetime,
        end_time: datetime,
        max_retries: int = 1,
    ) -> list[dict]:
        """获取用户主日历的日程事件（带重试）。

        先获取主日历 ID，再查询该日历的事件列表。

        Returns:
            事件列表，每个事件包含 event_id, summary, start_time, end_time, attendees 等
        """
        start_ts = str(int(start_time.timestamp()))
        end_ts = str(int(end_time.timestamp()))

        last_error: Exception | None = None
        for attempt in range(1 + max_retries):
            try:
                return await self._fetch_calendar_events(user_access_token, start_ts, end_ts)
            except FeishuAPIError:
                raise  # 业务错误不重试，直接抛
            except Exception as e:
                last_error = e
                logger.warning("获取日历事件失败 (尝试 %d/%d): %s", attempt + 1, 1 + max_retries, e)
                if attempt < max_retries:
                    await asyncio.sleep(0.5)
        raise last_error  # type: ignore[misc]

    async def _fetch_calendar_events(
        self,
        user_access_token: str,
        start_ts: str,
        end_ts: str,
    ) -> list[dict]:
        """内部实际获取日历事件的方法。"""
        all_events: list[dict] = []

        async with self._client() as client:
            # 先获取主日历 ID（有缓存）
            calendar_id = await self._get_primary_calendar_id(client, user_access_token)
            logger.info("使用日历 calendar_id=%s", calendar_id)

            page_token: str | None = None
            while True:
                params: dict = {
                    "start_time": start_ts,
                    "end_time": end_ts,
                    "page_size": 50,
                }
                if page_token:
                    params["page_token"] = page_token

                resp = await client.get(
                    f"{FEISHU_BASE_URL}/calendar/v4/calendars/{calendar_id}/events",
                    headers={"Authorization": f"Bearer {user_access_token}"},
                    params=params,
                )
                if resp.status_code != 200:
                    logger.error("日历API HTTP错误 status=%s body=%s", resp.status_code, resp.text[:500])
                    # 如果是 token 相关错误，清除日历缓存
                    if resp.status_code == 401:
                        self._calendar_id_cache.pop(user_access_token, None)
                    raise FeishuAPIError(f"HTTP {resp.status_code}: {resp.text[:200]}")
                data = resp.json()
                code = data.get("code", -1)

                if code != 0:
                    msg = data.get("msg", "未知错误")
                    logger.error("获取日历事件失败 (code=%s): %s", code, msg)
                    # token 无效相关错误码，清除缓存
                    if str(code) in ("99991671", "99991668", "99991672", "99991677"):
                        self._calendar_id_cache.pop(user_access_token, None)
                    raise FeishuAPIError(f"获取日历事件失败 (code={code}): {msg}")

                items = data.get("data", {}).get("items", [])
                logger.info("获取到 %d 个日历事件 (本页)", len(items))
                all_events.extend(items)

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.1)

        logger.info("共获取到 %d 个日历事件，开始补全参会人信息", len(all_events))

        # 并发获取每个事件的参会人（飞书事件列表 API 不返回参会人）
        sem = asyncio.Semaphore(5)  # 最多 5 个并发请求，避免触发限流

        async def _fill_attendees(ev: dict) -> None:
            eid = ev.get("event_id", "")
            if not eid:
                return
            async with sem:
                try:
                    attendees = await self._get_event_attendees(
                        user_access_token, calendar_id, eid,
                    )
                    ev["attendees"] = attendees
                except Exception as e:
                    logger.warning("获取事件 %s 参会人失败: %s", eid, e)

        await asyncio.gather(*[_fill_attendees(ev) for ev in all_events])
        return all_events

    async def _get_event_attendees(
        self,
        user_access_token: str,
        calendar_id: str,
        event_id: str,
    ) -> list[dict]:
        """获取单个日历事件的参会人列表。

        GET /calendar/v4/calendars/{calendar_id}/events/{event_id}/attendees
        """
        all_attendees: list[dict] = []
        async with self._client() as client:
            page_token: str | None = None
            while True:
                params: dict = {
                    "page_size": 50,
                    "user_id_type": "open_id",
                }
                if page_token:
                    params["page_token"] = page_token

                resp = await client.get(
                    f"{FEISHU_BASE_URL}/calendar/v4/calendars/{calendar_id}/events/{event_id}/attendees",
                    headers={"Authorization": f"Bearer {user_access_token}"},
                    params=params,
                )
                if resp.status_code != 200:
                    logger.debug("获取参会人 HTTP错误 event=%s status=%s", event_id, resp.status_code)
                    break
                data = resp.json()
                if data.get("code", -1) != 0:
                    logger.debug("获取参会人失败 event=%s code=%s msg=%s",
                                 event_id, data.get("code"), data.get("msg"))
                    break

                items = data.get("data", {}).get("items", [])
                all_attendees.extend(items)
                logger.debug("事件 %s 获取到 %d 个参会人 (本页)", event_id, len(items))

                if not data.get("data", {}).get("has_more"):
                    break
                page_token = data.get("data", {}).get("page_token")
                await asyncio.sleep(0.05)

        if all_attendees:
            # 打印第一个参会人的原始字段帮助排查
            logger.info("事件 %s 共 %d 个参会人, 样例字段: %s",
                        event_id, len(all_attendees), list(all_attendees[0].keys()))
        return all_attendees

    async def send_bot_message(
        self,
        receive_id: str,
        msg_type: str,
        content: str,
        receive_id_type: str = "open_id",
    ) -> dict:
        """通过飞书机器人向用户发送消息。

        POST /open-apis/im/v1/messages?receive_id_type=open_id
        使用 tenant_access_token（应用身份）发送。

        Args:
            receive_id: 接收者 ID（open_id / chat_id 等）
            msg_type: 消息类型，如 "text" / "interactive"
            content: 消息内容 JSON 字符串
            receive_id_type: ID 类型，默认 "open_id"

        Returns:
            API 响应 data
        """
        token = await self.get_tenant_access_token()

        async with self._client() as client:
            resp = await client.post(
                f"{FEISHU_BASE_URL}/im/v1/messages",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json; charset=utf-8",
                },
                params={"receive_id_type": receive_id_type},
                json={
                    "receive_id": receive_id,
                    "msg_type": msg_type,
                    "content": content,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            code = data.get("code", -1)
            if code != 0:
                msg = data.get("msg", "未知错误")
                logger.error("发送飞书消息失败 (code=%s): %s", code, msg)
                raise FeishuAPIError(f"发送飞书消息失败: {msg}")
            return data.get("data", {})


class FeishuAPIError(Exception):
    """飞书 API 调用异常。"""


# 模块级单例
feishu_client = FeishuClient()
