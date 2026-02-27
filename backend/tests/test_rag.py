"""RAG 模块单元测试。"""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.rag import HybridSearcher, SearchResult

pytestmark = pytest.mark.asyncio


class TestRRFFusion:
    """Reciprocal Rank Fusion 混合检索测试。"""

    async def test_rrf_merges_two_result_sets(self):
        """RRF 正确合并两路检索结果并去重。"""
        vector_results = [
            SearchResult("r1", "标题1", "内容1", "conversation", "ou_a", 0.9),
            SearchResult("r2", "标题2", "内容2", "conversation", "ou_a", 0.8),
            SearchResult("r3", "标题3", "内容3", "conversation", "ou_a", 0.7),
        ]
        bm25_results = [
            SearchResult("r2", "标题2", "内容2", "conversation", "ou_a", 5.0),
            SearchResult("r4", "标题4", "内容4", "conversation", "ou_a", 4.0),
            SearchResult("r1", "标题1", "内容1", "conversation", "ou_a", 3.0),
        ]

        searcher = HybridSearcher()
        with (
            patch.object(
                searcher.vector_searcher, "search",
                new_callable=AsyncMock, return_value=vector_results,
            ),
            patch.object(
                searcher.bm25_searcher, "search",
                new_callable=AsyncMock, return_value=bm25_results,
            ),
        ):
            results = await searcher.search("query", "ou_a", "employee", AsyncMock(), top_k=3)

        ids = [r.feishu_record_id for r in results]
        # r1 和 r2 出现在两路中，RRF 分数更高，应排在前面
        assert "r1" in ids
        assert "r2" in ids
        assert len(results) == 3
        # 无重复
        assert len(set(ids)) == 3

    async def test_rrf_empty_results(self):
        """两路均无结果时返回空。"""
        searcher = HybridSearcher()
        with (
            patch.object(
                searcher.vector_searcher, "search",
                new_callable=AsyncMock, return_value=[],
            ),
            patch.object(
                searcher.bm25_searcher, "search",
                new_callable=AsyncMock, return_value=[],
            ),
        ):
            results = await searcher.search("query", "ou_a", "employee", AsyncMock())

        assert results == []

    async def test_rrf_respects_top_k(self):
        """RRF 结果不超过 top_k。"""
        many_results = [
            SearchResult(f"r{i}", f"标题{i}", f"内容{i}", "conversation", "ou_a")
            for i in range(20)
        ]

        searcher = HybridSearcher()
        with (
            patch.object(
                searcher.vector_searcher, "search",
                new_callable=AsyncMock, return_value=many_results,
            ),
            patch.object(
                searcher.bm25_searcher, "search",
                new_callable=AsyncMock, return_value=[],
            ),
        ):
            results = await searcher.search("query", "ou_a", "employee", AsyncMock(), top_k=5)

        assert len(results) <= 5


class TestPermissionFiltering:
    """权限过滤测试（检查 SQL 参数传递）。"""

    async def test_vector_searcher_passes_permission_params(self):
        """VectorSearcher 传递正确的权限参数。"""
        from app.services.rag import VectorSearcher

        searcher = VectorSearcher()
        mock_db = AsyncMock()
        mock_result = AsyncMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        with patch(
            "app.services.rag.llm_client.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            await searcher.search("query", "ou_employee", "employee", mock_db, top_k=5)

        # 检查传给 SQL 的参数
        call_args = mock_db.execute.call_args
        params = call_args[0][1]
        assert params["is_privileged"] is False
        assert params["user_open_id"] == "ou_employee"
        assert params["top_k"] == 5

    async def test_admin_is_privileged(self):
        """admin 用户 is_privileged=True。"""
        from app.services.rag import VectorSearcher

        searcher = VectorSearcher()
        mock_db = AsyncMock()
        mock_result = AsyncMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        with patch(
            "app.services.rag.llm_client.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            await searcher.search("query", "ou_admin", "admin", mock_db, top_k=5)

        params = mock_db.execute.call_args[0][1]
        assert params["is_privileged"] is True


class TestContextBuilding:
    """RAG 上下文构建测试。"""

    def test_build_context_with_results(self):
        """有检索结果时构建编号上下文。"""
        from app.api.chat import _build_context

        results = [
            SearchResult("r1", "标题1", "内容1", "conversation", "ou_a"),
            SearchResult("r2", None, "内容2", "document", "ou_a"),
        ]
        context = _build_context(results)
        assert "[1]" in context
        assert "[2]" in context
        assert "标题1" in context
        assert "无标题" in context  # r2 没有标题

    def test_build_context_empty(self):
        """无检索结果时返回提示。"""
        from app.api.chat import _build_context

        context = _build_context([])
        assert "未检索到" in context

    def test_build_messages_truncates_history(self):
        """消息构建正确截断历史。"""
        from app.api.chat import _build_messages, MAX_HISTORY_TURNS

        long_history = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"msg{i}"}
            for i in range(30)
        ]
        messages = _build_messages("question", long_history, "context")

        # system + truncated history + user question
        # Truncated history = MAX_HISTORY_TURNS * 2 = 20
        assert messages[0]["role"] == "system"
        assert messages[-1]["role"] == "user"
        assert messages[-1]["content"] == "question"
        assert len(messages) == 1 + MAX_HISTORY_TURNS * 2 + 1


class TestChatEndpoints:
    """Chat API 端点测试。"""

    async def test_ask_endpoint(self, authed_client):
        """非流式问答接口返回正确结构。"""
        mock_search_results = [
            SearchResult("r1", "标题", "内容", "conversation", "ou_a"),
        ]
        mock_response = AsyncMock()
        mock_response.choices = [AsyncMock(message=AsyncMock(content="这是回答"))]

        with (
            patch(
                "app.api.chat.hybrid_searcher.search",
                new_callable=AsyncMock,
                return_value=mock_search_results,
            ),
            patch("app.api.chat._get_agent_client") as mock_client_factory,
        ):
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_client_factory.return_value = mock_client

            resp = await authed_client.post(
                "/api/chat/ask",
                json={"question": "测试问题", "history": []},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "answer" in data
        assert data["answer"] == "这是回答"
        assert "sources" in data
        assert "r1" in data["sources"]

    async def test_stream_endpoint_returns_sse(self, authed_client):
        """流式接口返回 text/event-stream 格式。"""
        with (
            patch(
                "app.api.chat.hybrid_searcher.search",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch("app.api.chat._get_agent_client") as mock_client_factory,
        ):
            # Mock 流式响应
            async def _mock_stream():
                chunk = AsyncMock()
                chunk.choices = [AsyncMock(delta=AsyncMock(content="你好"))]
                yield chunk

            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=_mock_stream())
            mock_client_factory.return_value = mock_client

            resp = await authed_client.post(
                "/api/chat/stream",
                json={"question": "你好"},
            )

        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

    async def test_ask_requires_auth(self, client):
        """未认证用户无法访问问答接口。"""
        resp = await client.post("/api/chat/ask", json={"question": "test"})
        assert resp.status_code in (401, 403)

    async def test_stream_requires_auth(self, client):
        """未认证用户无法访问流式接口。"""
        resp = await client.post("/api/chat/stream", json={"question": "test"})
        assert resp.status_code in (401, 403)
