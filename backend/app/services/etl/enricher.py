"""ETL Step 2: LLM 智能提取 — 一次调用提取 summary/keywords/people/sentiment。"""

import json
import logging
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

# 内容类型的中文描述，用于 prompt
CONTENT_TYPE_LABELS = {
    "document": "文档",
    "meeting": "会议纪要",
    "chat_message": "聊天记录",
    "structured_table": "结构化数据表",
}

ENRICH_PROMPT = """你是一个数据分析专家。请分析以下{content_type_label}内容，提取结构化信息。

## 内容
{content}

## 要求
1. summary: 生成100-200字的摘要，准确概括核心内容
2. keywords: 提取5-10个关键词/主题词，按重要性排序
3. involved_people: 提取所有涉及的人物，标注角色
4. sentiment: 判断整体情感倾向

## 人物角色说明
- author: 作者/撰写者
- organizer: 组织者/发起人
- participant: 参与者/与会者
- sender: 发送者
- mentioned: 被提及的人
- assignee: 被指派任务的人

## 输出格式（仅输出 JSON）
{{
  "summary": "摘要文本",
  "keywords": ["关键词1", "关键词2"],
  "involved_people": [
    {{"name": "人名", "role": "author"}}
  ],
  "sentiment": "positive"
}}

sentiment 只能是: positive / neutral / negative
只输出 JSON，不要输出其他内容。"""

MAX_RETRIES = 3
MAX_CONTENT_LEN = 6000  # 截断长内容，避免超 token


@dataclass
class EnrichResult:
    """LLM 提取结果。"""
    summary: str | None = None
    keywords: list[str] = field(default_factory=list)
    involved_people: list[dict] = field(default_factory=list)
    sentiment: str | None = None


class ContentEnricher:
    """LLM 智能提取器：一次调用提取四个维度的结构化信息。"""

    async def enrich(
        self,
        content_text: str,
        content_type: str,
        title: str | None = None,
    ) -> EnrichResult:
        """调用 LLM 提取 summary/keywords/people/sentiment。"""
        if not content_text or not content_text.strip():
            return EnrichResult()

        if not settings.llm_api_key or settings.llm_api_key.startswith("sk-xxx"):
            logger.info("LLM 未配置，跳过内容增强")
            return EnrichResult()

        # 构建输入：标题 + 内容
        full_text = content_text
        if title:
            full_text = f"标题: {title}\n\n{content_text}"

        # 截断过长内容
        if len(full_text) > MAX_CONTENT_LEN:
            full_text = full_text[:MAX_CONTENT_LEN] + "\n...(内容已截断)"

        content_type_label = CONTENT_TYPE_LABELS.get(content_type, "内容")
        prompt = ENRICH_PROMPT.format(
            content_type_label=content_type_label,
            content=full_text,
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                from app.services.llm import llm_client
                response = await llm_client.chat_client.chat.completions.create(
                    model=settings.llm_model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                )
                result_text = response.choices[0].message.content.strip()

                # 提取 JSON
                if "```" in result_text:
                    result_text = result_text.split("```")[1]
                    if result_text.startswith("json"):
                        result_text = result_text[4:]
                    result_text = result_text.strip()

                parsed = json.loads(result_text)
                logger.info("内容增强成功 (第 %d 次尝试, type=%s)", attempt, content_type)

                return EnrichResult(
                    summary=parsed.get("summary"),
                    keywords=parsed.get("keywords", []),
                    involved_people=parsed.get("involved_people", []),
                    sentiment=self._validate_sentiment(parsed.get("sentiment")),
                )
            except (json.JSONDecodeError, IndexError, KeyError) as e:
                logger.warning("内容增强 JSON 解析失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return EnrichResult()
            except Exception as e:
                logger.warning("内容增强 LLM 调用失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return EnrichResult()

        return EnrichResult()

    async def resolve_people_ids(
        self,
        people: list[dict],
        db: AsyncSession,
    ) -> list[dict]:
        """尝试将人名匹配到系统内用户 ID。"""
        if not people:
            return people

        # 批量查询所有用户名
        result = await db.execute(select(User))
        users = result.scalars().all()

        # 构建名称 -> user_id 映射
        name_map: dict[str, str] = {}
        for user in users:
            if user.name:
                name_map[user.name] = user.feishu_open_id
            if user.en_name:
                name_map[user.en_name] = user.feishu_open_id

        # 匹配
        resolved = []
        for person in people:
            name = person.get("name", "").strip()
            if name in name_map:
                person["user_id"] = name_map[name]
            resolved.append(person)

        return resolved

    @staticmethod
    def _validate_sentiment(value: str | None) -> str | None:
        """校验 sentiment 值。"""
        if value in ("positive", "neutral", "negative"):
            return value
        return None


# 模块级单例
content_enricher = ContentEnricher()
