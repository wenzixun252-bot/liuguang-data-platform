"""LLM 调用封装 — Schema 映射 & Embedding 生成 & 文件解析。"""

import asyncio
import base64
import json
import logging

import httpx

from app.config import settings


# ── 轻量 OpenAI 兼容客户端（替代 openai SDK，解决 Windows HTTP/2 兼容问题） ──


class _Obj:
    """将 dict 转为可用 . 访问的对象。"""
    def __init__(self, d: dict):
        for k, v in d.items():
            if isinstance(v, dict):
                setattr(self, k, _Obj(v))
            elif isinstance(v, list):
                setattr(self, k, [_Obj(i) if isinstance(i, dict) else i for i in v])
            else:
                setattr(self, k, v)

    def __getattr__(self, name):
        return None


class _ChatCompletions:
    def __init__(self, client: "LiteOpenAIClient"):
        self._c = client

    async def create(self, **kwargs):
        stream = kwargs.pop("stream", False)
        resp = await self._c._post("/chat/completions", {**kwargs, "stream": stream})
        if stream:
            return self._stream(resp)
        data = resp.json()
        return _Obj(data)

    async def _stream(self, resp: httpx.Response):
        try:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    return
                try:
                    yield _Obj(json.loads(payload))
                except json.JSONDecodeError:
                    continue
        finally:
            await resp.aclose()


class _Chat:
    def __init__(self, client: "LiteOpenAIClient"):
        self.completions = _ChatCompletions(client)


class _Embeddings:
    def __init__(self, client: "LiteOpenAIClient"):
        self._c = client

    async def create(self, **kwargs):
        resp = await self._c._post("/embeddings", kwargs)
        return _Obj(resp.json())


class _AudioTranscriptions:
    def __init__(self, client: "LiteOpenAIClient"):
        self._c = client

    async def create(self, *, model: str, file, response_format: str = "json", **kwargs):
        files = {"file": file}
        data = {"model": model, "response_format": response_format, **kwargs}
        resp = await self._c._post_form("/audio/transcriptions", data=data, files=files)
        if response_format == "text":
            return _Obj({"text": resp.text})
        return _Obj(resp.json())


class _Audio:
    def __init__(self, client: "LiteOpenAIClient"):
        self.transcriptions = _AudioTranscriptions(client)


class LiteOpenAIClient:
    """轻量级 OpenAI 兼容客户端，用 httpx 直连，绕过 openai SDK 的 HTTP/2 问题。"""

    def __init__(self, api_key: str, base_url: str, timeout: float = 60.0):
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._timeout = httpx.Timeout(timeout, connect=10.0)
        self._client: httpx.AsyncClient | None = None
        self.chat = _Chat(self)
        self.embeddings = _Embeddings(self)
        self.audio = _Audio(self)

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                follow_redirects=True,
            )
        return self._client

    async def _post(self, path: str, body: dict) -> httpx.Response:
        client = self._get_client()
        stream = body.get("stream", False)
        url = f"{self._base_url}{path}"
        if stream:
            req = client.build_request("POST", url, json=body, headers=self._headers)
            resp = await client.send(req, stream=True)
            resp.raise_for_status()
            return resp
        resp = await client.post(url, json=body, headers=self._headers)
        resp.raise_for_status()
        return resp

    async def _post_form(self, path: str, data: dict, files: dict) -> httpx.Response:
        client = self._get_client()
        url = f"{self._base_url}{path}"
        headers = {"Authorization": self._headers["Authorization"]}
        resp = await client.post(url, data=data, files=files, headers=headers)
        resp.raise_for_status()
        return resp


def create_openai_client(api_key: str, base_url: str, timeout: float = 60.0) -> LiteOpenAIClient:
    """创建轻量 OpenAI 兼容客户端。"""
    return LiteOpenAIClient(api_key=api_key, base_url=base_url, timeout=timeout)

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

PARSE_COMMUNICATION_PROMPT = """你是一个会议纪要/沟通记录分析专家。请从以下飞书云文档内容中提取沟通资产的结构化字段。

## 文档内容
{content}

## 要求
请提取以下字段，输出为 JSON 格式：
1. title: 会议或沟通的标题
2. comm_type: 沟通类型，从内容推断（"meeting" 表示会议纪要, "chat" 表示群聊摘要, "recording" 表示录音转写）
3. initiator: 会议组织者或发起人（如果能识别）
4. participants: 参与人数组（从内容中提取人名）
5. summary: 内容摘要（100-200字）
6. conclusions: 会议结论或决议要点
7. action_items: 待办事项数组，每项包含 {{"assignee": "负责人", "task": "任务描述", "deadline": "截止日期或null"}}
8. keywords: 关键词标签数组
9. sentiment: 整体情感倾向（"positive" / "neutral" / "negative"）
10. duration_minutes: 会议时长（分钟，如果能推断）
11. comm_time: 本次会议/录音实际发生的日期时间（ISO 格式，如 "2026-03-06T11:04:00+08:00"）。提取规则：优先从文档头部的"录音时间""会议时间""日期"等元数据字段提取；也可从标题中的日期提取（如"xxx 2026年3月6日"）。**绝对不要**把正文讨论中提到的历史日期当作 comm_time。如果找不到明确的会议/录音发生时间，返回 null

## 输出格式（仅输出 JSON）
{{"title": "...", "comm_type": "meeting", "initiator": null, "participants": [], "summary": "...", "conclusions": null, "action_items": [], "keywords": [], "sentiment": "neutral", "duration_minutes": null, "comm_time": null}}
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
        self._chat_client: LiteOpenAIClient | None = None
        self._embedding_client: LiteOpenAIClient | None = None

    @property
    def chat_client(self) -> LiteOpenAIClient:
        if self._chat_client is None:
            self._chat_client = create_openai_client(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                timeout=60.0,
            )
        return self._chat_client

    @property
    def embedding_client(self) -> LiteOpenAIClient:
        if self._embedding_client is None:
            self._embedding_client = create_openai_client(
                api_key=settings.embedding_api_key,
                base_url=settings.embedding_base_url,
                timeout=30.0,
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

    async def parse_communication_doc(self, content: str) -> dict:
        """调用 LLM 从云文档文本中提取沟通资产的结构化字段。"""
        truncated = content[:8000] if len(content) > 8000 else content
        prompt = PARSE_COMMUNICATION_PROMPT.format(content=truncated)
        default = {
            "title": None, "comm_type": "meeting", "initiator": None,
            "participants": [], "summary": None, "conclusions": None,
            "action_items": [], "keywords": [], "sentiment": "neutral",
            "duration_minutes": None, "comm_time": None,
        }

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
                logger.info("沟通资产解析成功 (第 %d 次尝试)", attempt)
                return parsed
            except (json.JSONDecodeError, IndexError, KeyError) as e:
                logger.warning("沟通资产解析 JSON 失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return default
                await asyncio.sleep(2)  # 重试前等待，避免立即重试
            except Exception as e:
                logger.warning("LLM 调用失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return default
                await asyncio.sleep(3)  # LLM 故障时等稍久一点再重试

        return default

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
