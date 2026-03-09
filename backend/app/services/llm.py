"""LLM 调用封装 — Schema 映射 & Embedding 生成 & 文件解析。"""

import base64
import json
import logging

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

# ── 三套目标 Schema 定义 ─────────────────────────────────

TARGET_SCHEMA_DOCUMENT = """
feishu_record_id: 记录唯一标识
owner_id: 数据归属人的飞书 open_id
title: 文档标题
content_text: 文档正文/核心内容
author: 作者
source_url: 文档链接/URL
feishu_created_at: 飞书端创建时间
feishu_updated_at: 飞书端更新时间
""".strip()

TARGET_SCHEMA_COMMUNICATION = """
feishu_record_id: 记录唯一标识
owner_id: 数据归属人的飞书 open_id
comm_type: 沟通类型(meeting/chat/recording)
title: 会议主题/录音标题（会话可为空）
content_text: 正文内容（会议纪要/消息内容）
comm_time: 会议时间/发送时间
initiator: 组织者/发送者
participants: 参与人/提及人列表
duration_minutes: 时长(分钟，会议独有)
location: 会议地点/链接
agenda: 议程
conclusions: 结论
action_items: 行动项/待办
source_url: 链接
recording_url: 录音/录像链接
transcript: AI转写文本/录音文字
chat_id: 会话 ID/群组 ID
chat_type: 聊天类型(group/private)
chat_name: 群名称/会话名称
message_type: 消息类型(text/image/file等)
reply_to: 回复的记录 ID
feishu_created_at: 飞书端创建时间
feishu_updated_at: 飞书端更新时间
""".strip()

TARGET_SCHEMAS = {
    "document": TARGET_SCHEMA_DOCUMENT,
    "communication": TARGET_SCHEMA_COMMUNICATION,
    # 兼容旧值
    "meeting": TARGET_SCHEMA_COMMUNICATION,
    "chat_message": TARGET_SCHEMA_COMMUNICATION,
}

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
{{"feishu_record_id": "record_id", "owner_id": "创建人", "title": "标题", "content_text": "内容"}}
"""

PARSE_FILE_PROMPT = """你是一个文档内容提取专家。请从以下{file_type}文件内容中提取结构化字段。

## 文件内容
{content}

## 要求
请提取以下字段，输出为 JSON 格式：
1. title: 文档标题（从内容中推断）
2. summary: 内容摘要（100-200字）
3. author: 作者（如果能识别）
4. tags: 关键词标签数组
5. category: 文档分类（如：技术文档、会议纪要、报告、通知 等）

## 输出格式
{{"title": "...", "summary": "...", "author": null, "tags": ["tag1", "tag2"], "category": "..."}}
"""

PARSE_IMAGE_PROMPT = """你是一个图片内容识别专家。请仔细查看这张图片，识别其中的所有文字和视觉内容。

## 要求
1. content_text: 图片中的所有文字内容（完整提取，保留原始格式）
2. title: 图片的标题或主题（从内容推断）
3. summary: 图片内容的摘要描述（100-200字，描述图片展示了什么）
4. author: 作者（如果能识别）
5. tags: 关键词标签数组
6. category: 内容分类（如：截图、流程图、表格、照片、文档扫描 等）

## 输出格式（仅输出 JSON）
{"content_text": "...", "title": "...", "summary": "...", "author": null, "tags": ["tag1"], "category": "..."}
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
        target_table: str = "document",
    ) -> dict:
        """将源表 Schema 与目标标准 Schema 传入 LLM，返回字段映射字典。"""
        target_schema = TARGET_SCHEMAS.get(target_table, TARGET_SCHEMA_DOCUMENT)

        source_desc = "\n".join(
            f"{f.get('field_name', f.get('name', '未知'))}: {f.get('description', f.get('type', ''))}"
            for f in source_schema
        )

        prompt = SCHEMA_MAPPING_PROMPT.format(
            target_schema=target_schema,
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
                if "```" in content:
                    content = content.split("```")[1]
                    if content.startswith("json"):
                        content = content[4:]
                    content = content.strip()
                mapping = json.loads(content)
                logger.info("Schema 映射成功 (第 %d 次尝试, target=%s)", attempt, target_table)
                return mapping
            except (json.JSONDecodeError, IndexError, KeyError) as e:
                logger.warning("Schema 映射 JSON 解析失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    raise LLMError(f"Schema 映射失败: LLM 输出无法解析为 JSON (重试 {MAX_RETRIES} 次)") from e
            except Exception as e:
                logger.warning("LLM 调用失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    raise LLMError(f"Schema 映射失败: {e}") from e

        raise LLMError("Schema 映射失败: 未知错误")

    # ── 文件内容解析 ──────────────────────────────────────

    async def parse_uploaded_file(self, content: str, file_type: str) -> dict:
        """调用 LLM 从文件文本中提取结构化字段。"""
        # 截断过长内容
        truncated = content[:8000] if len(content) > 8000 else content

        prompt = PARSE_FILE_PROMPT.format(
            file_type=file_type,
            content=truncated,
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = await self.chat_client.chat.completions.create(
                    model=settings.llm_model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                )
                result_text = response.choices[0].message.content.strip()
                if "```" in result_text:
                    result_text = result_text.split("```")[1]
                    if result_text.startswith("json"):
                        result_text = result_text[4:]
                    result_text = result_text.strip()
                parsed = json.loads(result_text)
                logger.info("文件解析成功 (第 %d 次尝试)", attempt)
                return parsed
            except (json.JSONDecodeError, IndexError, KeyError) as e:
                logger.warning("文件解析 JSON 失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    # 返回默认值而非抛异常
                    return {"title": None, "summary": None, "author": None, "tags": [], "category": None}
            except Exception as e:
                logger.warning("LLM 调用失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return {"title": None, "summary": None, "author": None, "tags": [], "category": None}

        return {"title": None, "summary": None, "author": None, "tags": [], "category": None}

    # ── 图片内容识别 ──────────────────────────────────────

    async def parse_image_file(self, image_bytes: bytes, ext: str) -> dict:
        """调用视觉模型识别图片内容，返回结构化字段。"""
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = await self.chat_client.chat.completions.create(
                    model=settings.vision_llm_model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                                {"type": "text", "text": PARSE_IMAGE_PROMPT},
                            ],
                        }
                    ],
                    temperature=0.0,
                    max_tokens=4096,
                )
                result_text = response.choices[0].message.content.strip()
                if "```" in result_text:
                    result_text = result_text.split("```")[1]
                    if result_text.startswith("json"):
                        result_text = result_text[4:]
                    result_text = result_text.strip()
                parsed = json.loads(result_text)
                logger.info("图片解析成功 (第 %d 次尝试)", attempt)
                return parsed
            except (json.JSONDecodeError, IndexError, KeyError) as e:
                logger.warning("图片解析 JSON 失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return {"content_text": "", "title": None, "summary": None, "author": None, "tags": [], "category": None}
            except Exception as e:
                logger.warning("视觉模型调用失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return {"content_text": "", "title": None, "summary": None, "author": None, "tags": [], "category": None}

        return {"content_text": "", "title": None, "summary": None, "author": None, "tags": [], "category": None}

    # ── Embedding 生成 ───────────────────────────────────

    async def generate_embedding(self, text: str) -> list[float]:
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

        return results


class LLMError(Exception):
    """LLM 调用异常。"""


# 模块级单例
llm_client = LLMClient()
