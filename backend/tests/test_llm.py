"""LLM 客户端单元测试。"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm import LLMClient, LLMError

pytestmark = pytest.mark.asyncio


def _make_client_with_mock_chat(mock_chat):
    """创建一个 LLMClient 并注入 mock chat client。"""
    client = LLMClient()
    client._chat_client = mock_chat
    return client


def _make_client_with_mock_embedding(mock_embed):
    """创建一个 LLMClient 并注入 mock embedding client。"""
    client = LLMClient()
    client._embedding_client = mock_embed
    return client


class TestSchemaMapping:
    """schema_mapping 测试。"""

    async def test_schema_mapping_success(self):
        """LLM 返回有效 JSON 时成功。"""
        expected_mapping = {
            "feishu_record_id": "id",
            "owner_id": "creator",
            "title": "标题",
            "content_text": "内容",
        }

        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps(expected_mapping)))
        ]

        mock_chat = MagicMock()
        mock_chat.chat.completions.create = AsyncMock(return_value=mock_response)
        client = _make_client_with_mock_chat(mock_chat)

        result = await client.schema_mapping([{"field_name": "标题", "type": 1}])
        assert result == expected_mapping

    async def test_schema_mapping_with_markdown_wrapper(self):
        """LLM 输出被 ```json 包裹时正确提取。"""
        mapping = {"feishu_record_id": "id", "owner_id": "user"}
        content = f"```json\n{json.dumps(mapping)}\n```"

        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content=content))]

        mock_chat = MagicMock()
        mock_chat.chat.completions.create = AsyncMock(return_value=mock_response)
        client = _make_client_with_mock_chat(mock_chat)

        result = await client.schema_mapping([{"field_name": "id"}])
        assert result == mapping

    async def test_schema_mapping_retry_on_json_error(self):
        """JSON 解析失败时重试直到成功。"""
        valid_mapping = {"feishu_record_id": "id"}

        responses = [
            MagicMock(choices=[MagicMock(message=MagicMock(content="not json"))]),
            MagicMock(
                choices=[
                    MagicMock(message=MagicMock(content=json.dumps(valid_mapping)))
                ]
            ),
        ]

        mock_chat = MagicMock()
        mock_chat.chat.completions.create = AsyncMock(side_effect=responses)
        client = _make_client_with_mock_chat(mock_chat)

        result = await client.schema_mapping([{"field_name": "id"}])
        assert result == valid_mapping
        assert mock_chat.chat.completions.create.call_count == 2

    async def test_schema_mapping_all_retries_fail(self):
        """所有重试都失败时抛出 LLMError。"""
        bad_response = MagicMock(
            choices=[MagicMock(message=MagicMock(content="not json at all"))]
        )

        mock_chat = MagicMock()
        mock_chat.chat.completions.create = AsyncMock(return_value=bad_response)
        client = _make_client_with_mock_chat(mock_chat)

        with pytest.raises(LLMError, match="无法解析为 JSON"):
            await client.schema_mapping([{"field_name": "id"}])

        assert mock_chat.chat.completions.create.call_count == 3


class TestEmbedding:
    """Embedding 生成测试。"""

    async def test_generate_embedding(self):
        """单条 Embedding 生成。"""
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1, 0.2, 0.3])]

        mock_embed = MagicMock()
        mock_embed.embeddings.create = AsyncMock(return_value=mock_response)
        client = _make_client_with_mock_embedding(mock_embed)

        result = await client.generate_embedding("test text")
        assert result == [0.1, 0.2, 0.3]

    async def test_batch_generate_embeddings(self):
        """批量 Embedding 生成。"""
        mock_response = MagicMock()
        mock_response.data = [
            MagicMock(embedding=[0.1] * 3),
            MagicMock(embedding=[0.2] * 3),
        ]

        mock_embed = MagicMock()
        mock_embed.embeddings.create = AsyncMock(return_value=mock_response)
        client = _make_client_with_mock_embedding(mock_embed)

        results = await client.batch_generate_embeddings(["text1", "text2"])
        assert len(results) == 2
        assert results[0] == [0.1] * 3
        assert results[1] == [0.2] * 3

    async def test_batch_embedding_failure_returns_none(self):
        """批量 Embedding 失败时对应位置返回 None。"""
        mock_embed = MagicMock()
        mock_embed.embeddings.create = AsyncMock(side_effect=Exception("API 不可用"))
        client = _make_client_with_mock_embedding(mock_embed)

        results = await client.batch_generate_embeddings(["text1", "text2"])
        assert results == [None, None]
