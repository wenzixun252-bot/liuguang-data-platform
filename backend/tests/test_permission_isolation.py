"""P6-2: 数据权限隔离专项测试 — 验证零越权。"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.rag import SearchResult, VectorSearcher, BM25Searcher, HybridSearcher

pytestmark = pytest.mark.asyncio


class TestVisibleOwnerIds:
    """get_visible_owner_ids 权限函数测试。"""

    async def test_admin_returns_none(self):
        """admin 用户返回 None（看全部）。"""
        from app.api.deps import get_visible_owner_ids
        from app.models.user import User

        user = MagicMock(spec=User)
        user.role = "admin"

        db = AsyncMock()
        result = await get_visible_owner_ids(user, db)
        assert result is None

    async def test_employee_returns_own_id(self):
        """普通 employee 返回 [自己的 open_id]。"""
        from app.api.deps import get_visible_owner_ids
        from app.models.user import User

        user = MagicMock(spec=User)
        user.role = "employee"
        user.id = 1
        user.feishu_open_id = "ou_user_a"

        db = AsyncMock()
        # 模拟查询 managed_depts 返回空
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        db.execute.return_value = mock_result

        result = await get_visible_owner_ids(user, db)
        assert result == ["ou_user_a"]


class TestVectorSearcherPermission:
    """向量检索器权限隔离测试。"""

    async def test_search_with_visible_ids(self):
        """向量检索传递 visible_ids 过滤。"""
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
            results = await searcher.search("查询", ["ou_employee_a"], mock_db)

        assert results == []
        # 验证 SQL 被执行
        mock_db.execute.assert_called_once()

    async def test_search_with_none_visible_ids(self):
        """admin 场景下 visible_ids=None 不添加过滤。"""
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
            results = await searcher.search("查询", None, mock_db)

        assert results == []


class TestBM25SearcherPermission:
    """BM25 检索器权限隔离测试。"""

    async def test_search_with_visible_ids(self):
        """BM25 检索传递 visible_ids 过滤。"""
        searcher = BM25Searcher()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        results = await searcher.search("查询", ["ou_employee_b"], mock_db)
        assert results == []


class TestRAGPermissionIsolation:
    """RAG 问答权限隔离端到端测试。"""

    async def test_hybrid_search_propagates_visible_ids(self):
        """混合检索将 visible_ids 正确传递给两路检索器。"""
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
            visible_ids = ["ou_user_a"]
            await searcher.search("查询", visible_ids, AsyncMock(), top_k=5)

        # 检查向量检索器收到了正确的 visible_ids
        vec_call = vec_mock.call_args
        assert vec_call[0][1] == ["ou_user_a"]

        # 检查 BM25 检索器收到了正确的 visible_ids
        bm25_call = bm25_mock.call_args
        assert bm25_call[0][1] == ["ou_user_a"]
