"""P6-1: 端到端集成测试 — 核心链路。"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.utils.security import create_access_token

pytestmark = pytest.mark.asyncio


class TestAuthFlow:
    """认证完整流程集成测试。"""

    async def test_login_then_access_protected_endpoint(self, client, db_session):
        """飞书登录 → 获取 JWT → 携带 JWT 访问受保护接口。"""
        from app.models.user import User

        mock_user_info = {
            "open_id": "ou_integration_test",
            "union_id": "un_integration_test",
            "name": "集成测试用户",
            "avatar_url": "https://example.com/avatar.png",
            "email": "integration@test.com",
        }

        with patch(
            "app.api.auth.feishu_client.get_user_info_by_code",
            new_callable=AsyncMock,
            return_value=mock_user_info,
        ):
            # Step 1: 飞书 OAuth 回调获取 JWT
            resp = await client.post(
                "/api/auth/feishu/callback",
                json={"code": "test_code_integration"},
            )

        assert resp.status_code == 200
        token = resp.json()["access_token"]
        assert token

        # Step 2: 携带 JWT 访问 /api/users/me
        resp2 = await client.get(
            "/api/users/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 200
        assert resp2.json()["name"] == "集成测试用户"
        assert resp2.json()["feishu_open_id"] == "ou_integration_test"

    async def test_expired_token_rejected(self, client, test_user):
        """过期 token 访问受保护接口返回 401。"""
        from datetime import datetime, timedelta, timezone
        from jose import jwt
        from app.config import settings

        # 创建一个已过期的 token
        payload = {
            "sub": test_user.feishu_open_id,
            "role": "employee",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        expired_token = jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")

        resp = await client.get(
            "/api/users/me",
            headers={"Authorization": f"Bearer {expired_token}"},
        )
        assert resp.status_code == 401

    async def test_invalid_token_rejected(self, client):
        """无效 token 被拒绝。"""
        resp = await client.get(
            "/api/users/me",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert resp.status_code == 401

    async def test_no_token_rejected(self, client):
        """无 token 的请求被拒绝。"""
        resp = await client.get("/api/users/me")
        assert resp.status_code in (401, 403)


class TestRBACFlow:
    """RBAC 角色控制集成测试。"""

    async def test_employee_cannot_access_admin_endpoints(self, authed_client):
        """employee 用户无法访问 admin 接口。"""
        # ETL 管理接口需要 admin 角色
        resp = await authed_client.get("/api/etl/status")
        assert resp.status_code == 403

        resp = await authed_client.post("/api/etl/trigger")
        assert resp.status_code == 403

        resp = await authed_client.get("/api/etl/registry")
        assert resp.status_code == 403

    async def test_admin_can_access_admin_endpoints(self, admin_client):
        """admin 用户可以访问管理接口。"""
        resp = await admin_client.get("/api/etl/status")
        assert resp.status_code == 200

    async def test_admin_can_list_users(self, admin_client):
        """admin 可以列出所有用户。"""
        resp = await admin_client.get("/api/users")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_employee_cannot_list_users(self, authed_client):
        """employee 不能列出所有用户。"""
        resp = await authed_client.get("/api/users")
        assert resp.status_code == 403

    async def test_role_upgrade_flow(self, admin_client, test_user):
        """admin 升级用户角色后用户获得新权限。"""
        resp = await admin_client.patch(
            f"/api/users/{test_user.feishu_open_id}/role",
            json={"role": "admin"},
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "admin"


class TestETLPipelineIntegration:
    """ETL 管线集成测试（Mock 外部依赖）。"""

    async def test_extractor_to_transformer_flow(self):
        """Extractor 输出可以被 Transformer 消费。"""
        from app.services.etl.extractor import ExtractionResult
        from app.services.etl.transformer import DataTransformer

        # 模拟 Extractor 输出
        extraction = ExtractionResult(
            records=[
                {
                    "record_id": "rec_001",
                    "fields": {
                        "标题": "测试标题",
                        "内容": "测试内容文本",
                        "作者": [{"id": "ou_owner"}],
                        "创建时间": 1700000000000,
                    },
                },
            ],
            schema_fields=[
                {"field_name": "标题", "type": 1},
                {"field_name": "内容", "type": 1},
                {"field_name": "作者", "type": 11},
                {"field_name": "创建时间", "type": 5},
            ],
            app_token="app_test",
            table_id="tbl_test",
        )

        # Mock LLM schema mapping (target_field -> source_field)
        mock_mapping = {
            "title": "标题",
            "content_text": "内容",
            "owner_id": "作者",
            "feishu_created_at": "创建时间",
        }

        transformer = DataTransformer()
        with patch.object(
            transformer, "_get_or_create_mapping",
            new_callable=AsyncMock,
            return_value=mock_mapping,
        ):
            result = await transformer.transform(extraction, "conversation", AsyncMock())

        assert len(result.records) >= 1
        assert result.records[0].feishu_record_id == "rec_001"
        assert result.records[0].content_text == "测试内容文本"

    async def test_loader_upsert_logic(self):
        """Loader 可以执行 upsert 操作。"""
        from app.services.etl.loader import AssetLoader
        from app.services.etl.transformer import TransformResult, TransformedRecord

        loader = AssetLoader()
        mock_db = AsyncMock()

        transform_result = TransformResult(
            records=[
                TransformedRecord(
                    feishu_record_id="rec_001",
                    owner_id="ou_test",
                    source_app_token="app_test",
                    source_table_id="tbl_test",
                    content_text="测试内容",
                    asset_type="conversation",
                    asset_tags={},
                ),
            ],
            app_token="app_test",
            table_id="tbl_test",
        )

        with (
            patch.object(
                loader, "_update_sync_state",
                new_callable=AsyncMock,
            ),
            patch(
                "app.services.etl.loader.llm_client.batch_generate_embeddings",
                new_callable=AsyncMock,
                return_value=[[0.1] * 1536],
            ),
        ):
            count = await loader.load(transform_result, mock_db)

        assert count == 1
        mock_db.execute.assert_called()
        mock_db.commit.assert_called()


class TestRAGIntegration:
    """RAG 检索 + 问答集成测试。"""

    async def test_hybrid_search_with_both_searchers(self):
        """混合检索同时调用向量和 BM25 检索器。"""
        from app.services.rag import HybridSearcher, SearchResult

        searcher = HybridSearcher()

        vec_results = [
            SearchResult("r1", "标题A", "内容A", "conversation", "ou_a", 0.9),
        ]
        bm25_results = [
            SearchResult("r2", "标题B", "内容B", "conversation", "ou_a", 5.0),
        ]

        with (
            patch.object(
                searcher.vector_searcher, "search",
                new_callable=AsyncMock, return_value=vec_results,
            ),
            patch.object(
                searcher.bm25_searcher, "search",
                new_callable=AsyncMock, return_value=bm25_results,
            ),
        ):
            results = await searcher.search("测试查询", "ou_a", "employee", AsyncMock(), top_k=5)

        assert len(results) == 2
        ids = {r.feishu_record_id for r in results}
        assert ids == {"r1", "r2"}

    async def test_chat_ask_endpoint_full_flow(self, authed_client):
        """非流式问答完整流程：检索 → 上下文 → LLM 响应。"""
        from app.services.rag import SearchResult

        mock_results = [
            SearchResult("r1", "会议纪要", "今天讨论了项目进展", "meeting_note", "ou_a"),
        ]
        mock_response = AsyncMock()
        mock_response.choices = [AsyncMock(message=AsyncMock(content="根据数据，项目进展顺利。"))]

        with (
            patch(
                "app.api.chat.hybrid_searcher.search",
                new_callable=AsyncMock,
                return_value=mock_results,
            ),
            patch("app.api.chat._get_agent_client") as mock_factory,
        ):
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_factory.return_value = mock_client

            resp = await authed_client.post(
                "/api/chat/ask",
                json={"question": "项目进展如何？", "history": []},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "answer" in data
        assert "项目进展顺利" in data["answer"]
        assert "r1" in data["sources"]

    async def test_chat_stream_endpoint_full_flow(self, authed_client):
        """流式问答完整流程：检索 → SSE 流。"""
        from app.services.rag import SearchResult

        with (
            patch(
                "app.api.chat.hybrid_searcher.search",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch("app.api.chat._get_agent_client") as mock_factory,
        ):
            async def _mock_stream():
                chunk = AsyncMock()
                chunk.choices = [AsyncMock(delta=AsyncMock(content="回答内容"))]
                yield chunk

            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=_mock_stream())
            mock_factory.return_value = mock_client

            resp = await authed_client.post(
                "/api/chat/stream",
                json={"question": "测试流式"},
            )

        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
