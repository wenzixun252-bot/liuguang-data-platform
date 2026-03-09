"""待办事项提取服务 — 从会议和聊天消息中AI提取待办。"""

import hashlib
import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.communication import Communication
from app.models.todo_item import TodoItem
from app.services.llm import llm_client

logger = logging.getLogger(__name__)

EXTRACT_TODO_PROMPT = """你是一个待办事项提取专家。请从以下文本中提取所有待办事项/行动项。

## 文本内容
{content}

## 要求
1. 提取所有明确或隐含的待办事项
2. 为每个待办设置合理的优先级 (low/medium/high)
3. 如果能推断截止日期，请设置（ISO格式，如 "2026-03-10"）
4. 严格只输出 JSON 数组，不要输出任何解释文字
5. JSON 中不要有尾逗号，使用双引号，null 值用 null 表示

## 输出格式（严格按此格式）
[{{"title": "待办标题", "description": "详细描述", "priority": "medium", "due_date": null}}]
"""


async def extract_todos_from_communications(
    db: AsyncSession,
    owner_id: str,
    days: int = 7,
) -> list[dict]:
    """从沟通记录（会议 + 会话）中提取待办。"""
    since = datetime.utcnow() - timedelta(days=days)

    result = await db.execute(
        select(Communication).where(
            and_(
                Communication.owner_id == owner_id,
                Communication.created_at >= since,
            )
        ).order_by(Communication.comm_time.desc().nullslast()).limit(200)
    )
    comms = result.scalars().all()

    todos = []
    for comm in comms:
        # 会议类：从 action_items JSONB 直接提取
        if comm.comm_type in ("meeting", "recording") and comm.action_items:
            for item in comm.action_items:
                task_text = item.get("task") or item.get("title") or ""
                if task_text:
                    todos.append({
                        "title": task_text[:512],
                        "description": item.get("description"),
                        "priority": "medium",
                        "due_date": item.get("deadline"),
                        "source_type": "communication",
                        "source_id": comm.id,
                        "source_text": task_text,
                    })

        # LLM 补充提取
        if comm.content_text and len(comm.content_text) > 50:
            llm_todos = await _llm_extract(comm.content_text[:4000])
            for t in llm_todos:
                todos.append({
                    **t,
                    "source_type": "communication",
                    "source_id": comm.id,
                    "source_text": comm.content_text[:200],
                })

    return todos


async def extract_and_save(
    db: AsyncSession,
    owner_id: str,
    days: int = 7,
) -> list[TodoItem]:
    """提取待办并去重保存到数据库。"""
    all_todos = await extract_todos_from_communications(db, owner_id, days)

    # 按 title 去重
    seen_titles: set[str] = set()
    unique_todos = []
    for t in all_todos:
        title_key = t["title"].strip().lower()
        if title_key not in seen_titles:
            seen_titles.add(title_key)
            unique_todos.append(t)

    # 检查数据库中已存在的待办（用 content_hash + title 双重去重）
    existing_hash_result = await db.execute(
        select(TodoItem.content_hash).where(
            and_(TodoItem.owner_id == owner_id, TodoItem.content_hash.isnot(None))
        )
    )
    existing_hashes = {r for r in existing_hash_result.scalars().all()}

    existing_title_result = await db.execute(
        select(TodoItem.title).where(TodoItem.owner_id == owner_id)
    )
    existing_titles = {r.lower() for r in existing_title_result.scalars().all()}

    saved = []
    for t in unique_todos:
        title_lower = t["title"].strip().lower()
        content_hash = hashlib.md5(
            f"{t['source_type']}:{t.get('source_id', '')}:{title_lower}".encode()
        ).hexdigest()

        if content_hash in existing_hashes or title_lower in existing_titles:
            continue

        due_date = None
        if t.get("due_date"):
            try:
                due_date = datetime.fromisoformat(str(t["due_date"]))
            except (ValueError, TypeError):
                pass

        item = TodoItem(
            owner_id=owner_id,
            title=t["title"][:512],
            description=t.get("description"),
            due_date=due_date,
            priority=t.get("priority", "medium"),
            source_type=t["source_type"],
            source_id=t.get("source_id"),
            source_text=t.get("source_text"),
            status="pending_review",
            content_hash=content_hash,
        )
        db.add(item)
        saved.append(item)

    if saved:
        await db.commit()
        for item in saved:
            await db.refresh(item)

    return saved


def _fix_json(text: str) -> str:
    """修复 LLM 返回的非标准 JSON（尾逗号、单引号等）。"""
    import re
    # 移除尾逗号（对象和数组最后一个元素后的逗号）
    text = re.sub(r",\s*([}\]])", r"\1", text)
    # 替换单引号为双引号（简单场景）
    # 只替换不在双引号字符串内部的单引号
    text = re.sub(r"(?<![\\])'\s*:", '":', text)
    text = re.sub(r":\s*'([^']*)'", r': "\1"', text)
    text = re.sub(r"^\s*'([^']*)'\s*:", r'"\1":', text, flags=re.MULTILINE)
    return text


async def _llm_extract(content: str) -> list[dict]:
    """调用LLM从文本中提取待办。"""
    prompt = EXTRACT_TODO_PROMPT.format(content=content)

    try:
        response = await llm_client.chat_client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
        )
        result_text = response.choices[0].message.content.strip()

        # 提取 JSON 代码块
        if "```" in result_text:
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
            result_text = result_text.strip()

        # 尝试直接解析
        try:
            items = json.loads(result_text)
        except json.JSONDecodeError:
            # 修复常见格式问题后重试
            fixed = _fix_json(result_text)
            try:
                items = json.loads(fixed)
            except json.JSONDecodeError:
                # 最后尝试：用正则提取 JSON 数组
                import re
                match = re.search(r"\[[\s\S]*\]", result_text)
                if match:
                    fixed2 = _fix_json(match.group())
                    items = json.loads(fixed2)
                else:
                    raise

        if isinstance(items, list):
            return items
        return []
    except Exception as e:
        logger.warning("LLM提取待办失败: %s", e)
        return []
