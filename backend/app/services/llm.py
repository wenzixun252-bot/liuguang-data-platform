"""LLM 调用封装 — Schema 映射 & Embedding 生成。"""

import json
import logging

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

# ── 目标标准 Schema 定义 ─────────────────────────────────

TARGET_SCHEMA_DESCRIPTION = """
feishu_record_id: 记录唯一标识
owner_id: 数据归属人的飞书 open_id
title: 记录标题/主题
content_text: 记录正文/核心内容
asset_type: 资产类型 (conversation / meeting_note / document / other)
feishu_created_at: 飞书端创建时间
feishu_updated_at: 飞书端更新时间
""".strip()

SCHEMA_MAPPING_PROMPT = """你是一个数据 Schema 映射专家。请将源表字段映射到目标标准字段。

## 目标标准字段
{target_schema}

## 源表字段
{source_schema}

## 要求
1. 输出 JSON 对象，key 为目标字段名，value 为对应的源字段名
2. 如果源表中没有匹配的字段，value 设为 null
3. 一个源字段只能映射到一个目标字段
4. feishu_record_id 通常对应记录的唯一ID或 record_id
5. content_text 应映射到包含主要内容的字段，如果有多个文本字段，选择最重要的那个
6. 只输出 JSON，不要输出其他内容

## 输出格式示例
{{"feishu_record_id": "record_id", "owner_id": "创建人", "title": "标题", "content_text": "内容", "asset_type": null, "feishu_created_at": "创建时间", "feishu_updated_at": "更新时间"}}
"""

MAX_RETRIES = 3


class LLMClient:
    """封装对 DeepSeek/Qwen 的 LLM 调用（兼容 OpenAI 格式）。"""

    def __init__(self) -> None:
        self._chat_client: AsyncOpenAI | None = None
        self._embedding_client: AsyncOpenAI | None = None

    @property
    def chat_client(self) -> AsyncOpenAI:
        if self._chat_client is None:
            self._chat_client = AsyncOpenAI(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
            )
        return self._chat_client

    @property
    def embedding_client(self) -> AsyncOpenAI:
        if self._embedding_client is None:
            self._embedding_client = AsyncOpenAI(
                api_key=settings.embedding_api_key,
                base_url=settings.embedding_base_url,
            )
        return self._embedding_client

    # ── Schema 映射 ──────────────────────────────────────

    async def schema_mapping(
        self,
        source_schema: list[dict],
    ) -> dict:
        """将源表 Schema 与目标标准 Schema 传入 LLM，返回字段映射字典。

        Args:
            source_schema: 源表字段列表，每项包含 field_name, type 等。

        Returns:
            映射字典，key 为目标字段名，value 为源字段名或 None。
        """
        source_desc = "\n".join(
            f"{f.get('field_name', f.get('name', '未知'))}: {f.get('description', f.get('type', ''))}"
            for f in source_schema
        )

        prompt = SCHEMA_MAPPING_PROMPT.format(
            target_schema=TARGET_SCHEMA_DESCRIPTION,
            source_schema=source_desc,
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = await self.chat_client.chat.completions.create(
                    model=settings.llm_model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                )
                content = response.choices[0].message.content.strip()
                # 提取 JSON（可能被 ```json ... ``` 包裹）
                if "```" in content:
                    content = content.split("```")[1]
                    if content.startswith("json"):
                        content = content[4:]
                    content = content.strip()
                mapping = json.loads(content)
                logger.info("Schema 映射成功 (第 %d 次尝试)", attempt)
                return mapping
            except (json.JSONDecodeError, IndexError, KeyError) as e:
                logger.warning("Schema 映射 JSON 解析失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    raise LLMError(f"Schema 映射失败: LLM 输出无法解析为 JSON (重试 {MAX_RETRIES} 次)") from e
            except Exception as e:
                logger.warning("LLM 调用失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    raise LLMError(f"Schema 映射失败: {e}") from e

        raise LLMError("Schema 映射失败: 未知错误")  # unreachable

    # ── Embedding 生成 ───────────────────────────────────

    async def generate_embedding(self, text: str) -> list[float]:
        """调用 Embedding 模型生成单条向量。"""
        response = await self.embedding_client.embeddings.create(
            model=settings.embedding_model,
            input=text,
        )
        return response.data[0].embedding

    async def batch_generate_embeddings(
        self,
        texts: list[str],
        batch_size: int = 20,
    ) -> list[list[float] | None]:
        """批量生成向量，每批最多 batch_size 条。

        Embedding 失败的条目返回 None，不阻塞其他条目。
        """
        results: list[list[float] | None] = [None] * len(texts)

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            try:
                response = await self.embedding_client.embeddings.create(
                    model=settings.embedding_model,
                    input=batch,
                )
                for j, item in enumerate(response.data):
                    results[i + j] = item.embedding
            except Exception as e:
                logger.warning("Embedding 批量生成失败 (batch %d-%d): %s", i, i + len(batch), e)
                # 失败的批次保持 None

        return results


class LLMError(Exception):
    """LLM 调用异常。"""


# 模块级单例
llm_client = LLMClient()
