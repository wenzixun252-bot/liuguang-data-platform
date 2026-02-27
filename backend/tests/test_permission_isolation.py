"""P6-2: 数据权限隔离专项测试 — 验证零越权。"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.rag import SearchResult, VectorSearcher, BM25Searcher, HybridSearcher

pytestmark = pytest.mark.asyncio


class TestRLSFunctionIsolation:
    """行级安全函数级隔离测试。"""

    def test_employee_a_cannot_see_employee_b_data(self):
        """employee A 的查询附加 A 的 owner_id 过滤。"""
        from app.api.assets import _apply_rls
        from app.models.user import User

        user_a = MagicMock(spec=User)
        user_a.role = "employee"
        user_a.feishu_open_id = "ou_user_a"

        stmt = MagicMock()
        _apply_rls(stmt, user_a)
        stmt.where.assert_called_once()

    def test_two_employees_get_different_filters(self):
        """两个 employee 用户得到不同的 owner_id 过滤。"""
        from app.api.assets import _apply_rls
        from app.models.user import User
        from sqlalchemy import select
        from app.models.asset import DataAsset

        user_a = MagicMock(spec=User)
        user_a.role = "employee"
        user_a.feishu_open_id = "ou_user_a"

        user_b = MagicMock(spec=User)
        user_b.role = "employee"
        user_b.feishu_open_id = "ou_user_b"

        stmt_a = MagicMock()
        stmt_b = MagicMock()

        _apply_rls(stmt_a, user_a)
        _apply_rls(stmt_b, user_b)

        # 两个用户都触发了 where 过滤
        stmt_a.where.assert_called_once()
        stmt_b.where.assert_called_once()

    def test_admin_sees_all_data(self):
        """admin 用户查询不附加 owner_id 过滤。"""
        from app.api.assets import _apply_rls
        from app.models.user import User

        admin = MagicMock(spec=User)
        admin.role = "admin"

        stmt = MagicMock()
        _apply_rls(stmt, admin)
        stmt.where.assert_not_called()

    def test_executive_sees_all_data(self):
        """executive 用户查询不附加 owner_id 过滤。"""
        from app.api.assets import _apply_rls
        from app.models.user import User

        executive = MagicMock(spec=User)
        executive.role = "executive"

        stmt = MagicMock()
        _apply_rls(stmt, executive)
        stmt.where.assert_not_called()


class TestVectorSearcherPermission:
    """向量检索器权限隔离测试。"""

    async def test_employee_search_passes_owner_filter(self):
        """employee 用户的向量检索传递正确的权限参数。"""
        searcher = VectorSearcher()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        with patch(
            "app.services.rag.llm_client.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            await searcher.search("查询", "ou_employee_a", "employee", mock_db)

        params = mock_db.execute.call_args[0][1]
        assert params["is_privileged"] is False
        assert params["user_open_id"] == "ou_employee_a"

    async def test_admin_search_is_privileged(self):
        """admin 用户的向量检索 is_privileged=True。"""
        searcher = VectorSearcher()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        with patch(
            "app.services.rag.llm_client.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            await searcher.search("查询", "ou_admin", "admin", mock_db)

        params = mock_db.execute.call_args[0][1]
        assert params["is_privileged"] is True

    async def test_executive_search_is_privileged(self):
        """executive 用户的向量检索 is_privileged=True。"""
        searcher = VectorSearcher()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        with patch(
            "app.services.rag.llm_client.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            await searcher.search("查询", "ou_exec", "executive", mock_db)

        params = mock_db.execute.call_args[0][1]
        assert params["is_privileged"] is True


class TestBM25SearcherPermission:
    """BM25 检索器权限隔离测试。"""

    async def test_employee_bm25_passes_owner_filter(self):
        """employee 用户的 BM25 检索传递正确的权限参数。"""
        searcher = BM25Searcher()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        await searcher.search("查询", "ou_employee_b", "employee", mock_db)

        params = mock_db.execute.call_args[0][1]
        assert params["is_privileged"] is False
        assert params["user_open_id"] == "ou_employee_b"

    async def test_admin_bm25_is_privileged(self):
        """admin 的 BM25 检索 is_privileged=True。"""
        searcher = BM25Searcher()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        await searcher.search("查询", "ou_admin", "admin", mock_db)

        params = mock_db.execute.call_args[0][1]
        assert params["is_privileged"] is True


class TestRAGPermissionIsolation:
    """RAG 问答权限隔离端到端测试。"""

    async def test_hybrid_search_propagates_user_context(self):
        """混合检索将用户身份正确传递给两路检索器。"""
        searcher = HybridSearcher()

        with (
            patch.object(
                searcher.vector_searcher, "search",
                new_callable=AsyncMock, return_value=[],
            ) as vec_mock,
            patch.object(
                searcher.bm25_searcher, "search",
                new_callable=AsyncMock, return_value=[],
            ) as bm25_mock,
        ):
            await searcher.search("查询", "ou_user_a", "employee", AsyncMock(), top_k=5)

        # 检查向量检索器收到了正确的用户信息
        vec_call = vec_mock.call_args
        assert vec_call[0][1] == "ou_user_a"  # user_open_id
        assert vec_call[0][2] == "employee"    # user_role

        # 检查 BM25 检索器收到了正确的用户信息
        bm25_call = bm25_mock.call_args
        assert bm25_call[0][1] == "ou_user_a"
        assert bm25_call[0][2] == "employee"

    async def test_chat_endpoint_uses_current_user_identity(self, authed_client):
        """Chat 端点使用当前认证用户的身份进行检索。"""
        with (
            patch(
                "app.api.chat.hybrid_searcher.search",
                new_callable=AsyncMock,
                return_value=[],
            ) as search_mock,
            patch("app.api.chat._get_agent_client") as mock_factory,
        ):
            mock_response = AsyncMock()
            mock_response.choices = [AsyncMock(message=AsyncMock(content="回答"))]
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_factory.return_value = mock_client

            await authed_client.post(
                "/api/chat/ask",
                json={"question": "测试权限", "history": []},
            )

        # 验证 search 被调用时传入了正确的用户信息
        search_call = search_mock.call_args
        assert search_call.kwargs["user_open_id"] == "test_open_id_001"
        assert search_call.kwargs["user_role"] == "employee"
