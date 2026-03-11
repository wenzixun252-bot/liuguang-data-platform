"""日程管家核心服务 — 会前简报上下文收集与 LLM 生成。"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import String, and_, or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.communication import Communication
from app.models.todo_item import TodoItem
from app.services.rag import hybrid_searcher

logger = logging.getLogger(__name__)

# ── 会前简报 System Prompt ─────────────────────────────────

MEETING_BRIEF_PROMPT = """你是"流光"会议准备助手。请根据以下信息，为即将到来的会议生成一份简洁实用的准备简报。

## 会议信息
- 主题: {summary}
- 时间: {start_time}
- 描述: {description}
- 参会人: {attendees}

## 参会人背景（来自知识图谱）
{participant_profiles}

## 历史会议记录
{historical_meetings}

## 相关文档
{related_documents}

## 未完成的行动项
{pending_todos}

## 相关聊天消息
{related_chats}

## 要求
请按以下结构生成会前简报：

### 👥 参会人背景
简述每位参会人的角色、相关项目和专长。

### 📋 历史会议回顾
总结与这些参会人之前开过的重要会议，提炼关键结论。

### 📄 相关文档摘要
列出与本次会议主题相关的重要文档及要点。

### ✅ 待处理事项
列出与这些参会人相关的未完成待办，需要在会议中讨论或跟进。

### 💡 建议讨论要点
基于以上所有信息，建议本次会议应重点讨论的话题。

注意：
1. 如果某个部分没有相关信息，简短说明"暂无相关数据"即可
2. 使用简洁专业的中文
3. 每个部分控制在3-5个要点以内
"""


async def gather_meeting_context(
    db: AsyncSession,
    owner_id: str,
    visible_ids: list[str] | None,
    event_summary: str,
    event_description: str | None,
    attendee_names: list[str],
    boost_tag_ids: list[int] | None = None,
) -> dict:
    """并行收集会议准备所需的所有上下文信息。

    返回 dict 包含：participant_profiles, historical_meetings,
    related_documents, pending_todos, related_chats
    """

    async def _get_participant_profiles() -> str:
        """从知识图谱查找参会人相关实体和关系。"""
        if not attendee_names:
            return "暂无参会人信息"

        profiles: list[str] = []
        for name in attendee_names[:10]:  # 最多处理 10 人
            # 查找 KG 中匹配的人物实体
            result = await db.execute(
                select(KGEntity).where(
                    and_(
                        KGEntity.owner_id == owner_id,
                        KGEntity.entity_type == "person",
                        KGEntity.name.ilike(f"%{name}%"),
                    )
                ).limit(1)
            )
            entity = result.scalar_one_or_none()
            if entity:
                # 查找该实体的关系
                rel_result = await db.execute(
                    select(KGRelation).where(
                        and_(
                            KGRelation.owner_id == owner_id,
                            or_(
                                KGRelation.source_entity_id == entity.id,
                                KGRelation.target_entity_id == entity.id,
                            ),
                        )
                    ).limit(5)
                )
                rels = rel_result.scalars().all()
                rel_texts = []
                for r in rels:
                    rel_texts.append(f"  - {r.source_name} → {r.relation_type} → {r.target_name}")
                rel_str = "\n".join(rel_texts) if rel_texts else "  暂无关联信息"
                profiles.append(f"**{name}** (类型: {entity.entity_type})\n{rel_str}")
            else:
                profiles.append(f"**{name}**: 知识图谱中暂无记录")

        return "\n\n".join(profiles)

    async def _get_historical_meetings() -> str:
        """查找与参会人有交集的历史会议。"""
        if not attendee_names:
            return "暂无历史会议"

        # 将 JSONB participants 转为文本后模糊匹配参会人姓名
        conditions = [
            func.cast(Communication.participants, String).ilike(f"%{name}%")
            for name in attendee_names[:5]
        ]
        try:
            result = await db.execute(
                select(Communication).where(
                    and_(
                        Communication.owner_id == owner_id,
                        Communication.comm_type == "meeting",
                        or_(*conditions),
                    )
                ).order_by(Communication.comm_time.desc().nullslast()).limit(5)
            )
            meetings = result.scalars().all()
        except Exception:
            # 回退：取最近的会议
            result = await db.execute(
                select(Communication).where(
                    Communication.owner_id == owner_id,
                    Communication.comm_type == "meeting",
                ).order_by(Communication.comm_time.desc().nullslast()).limit(5)
            )
            meetings = result.scalars().all()

        if not meetings:
            return "暂无历史会议"

        parts = []
        for m in meetings:
            time_str = m.comm_time.strftime("%Y-%m-%d %H:%M") if m.comm_time else "时间未知"
            conclusions = (m.conclusions or "无结论")[:200]
            parts.append(f"- **{m.title or '无标题'}** ({time_str})\n  结论: {conclusions}")

        return "\n".join(parts)

    async def _get_related_documents() -> str:
        """通过 RAG 搜索与会议主题相关的文档，支持标签加权。"""
        query = event_summary
        if event_description:
            query += " " + event_description[:200]

        try:
            results = await hybrid_searcher.search(
                query_text=query,
                visible_ids=visible_ids if visible_ids else [owner_id],
                db=db,
                source_tables=["document"],
                top_k=5,
                boost_tag_ids=boost_tag_ids,
            )
        except Exception as e:
            logger.warning("RAG 搜索文档失败: %s", e)
            return "暂无相关文档"

        if not results:
            return "暂无相关文档"

        parts = []
        for r in results:
            title = r.title or "无标题"
            content = (r.content_text or "")[:300]
            tag_info = f" [标签: {', '.join(r.matched_tags)}]" if r.matched_tags else ""
            parts.append(f"- **{title}**{tag_info}\n  摘要: {content}")

        return "\n".join(parts)

    async def _get_pending_todos() -> str:
        """查找与参会人相关的未完成待办。"""
        result = await db.execute(
            select(TodoItem).where(
                and_(
                    TodoItem.owner_id == owner_id,
                    TodoItem.status.in_(["pending_review", "in_progress"]),
                )
            ).order_by(TodoItem.created_at.desc()).limit(10)
        )
        todos = result.scalars().all()

        if not todos:
            return "暂无未完成待办"

        parts = []
        for t in todos:
            priority = {"high": "🔴高", "medium": "🟡中", "low": "🟢低"}.get(t.priority, t.priority)
            due = t.due_date.strftime("%Y-%m-%d") if t.due_date else "无截止日期"
            parts.append(f"- [{priority}] **{t.title}** (截止: {due})")

        return "\n".join(parts)

    async def _get_related_chats() -> str:
        """通过 RAG 搜索与会议主题相关的聊天消息，支持标签加权。"""
        try:
            results = await hybrid_searcher.search(
                query_text=event_summary,
                visible_ids=visible_ids if visible_ids else [owner_id],
                db=db,
                source_tables=["communication"],
                top_k=3,
                boost_tag_ids=boost_tag_ids,
            )
        except Exception as e:
            logger.warning("RAG 搜索聊天记录失败: %s", e)
            return "暂无相关聊天记录"

        if not results:
            return "暂无相关聊天记录"

        parts = []
        for r in results:
            content = (r.content_text or "")[:200]
            tag_info = f" [标签: {', '.join(r.matched_tags)}]" if r.matched_tags else ""
            parts.append(f"- {r.title or '聊天消息'}{tag_info}: {content}")

        return "\n".join(parts)

    # ── 顺序收集所有上下文 ──
    # 注意：不能用 asyncio.gather 并行，因为所有任务共享同一个
    # AsyncSession，而 AsyncSession 不支持并发访问，会导致会话
    # 状态损坏和查询失败。
    participant_profiles = await _get_participant_profiles()
    historical_meetings = await _get_historical_meetings()
    related_documents = await _get_related_documents()
    pending_todos = await _get_pending_todos()
    related_chats = await _get_related_chats()

    return {
        "participant_profiles": participant_profiles,
        "historical_meetings": historical_meetings,
        "related_documents": related_documents,
        "pending_todos": pending_todos,
        "related_chats": related_chats,
    }


def build_brief_prompt(
    event_summary: str,
    event_description: str | None,
    start_time: datetime,
    attendee_names: list[str],
    context: dict,
) -> str:
    """根据收集到的上下文构建 LLM prompt。"""
    return MEETING_BRIEF_PROMPT.format(
        summary=event_summary,
        start_time=start_time.strftime("%Y-%m-%d %H:%M"),
        description=event_description or "无",
        attendees="、".join(attendee_names) if attendee_names else "未知",
        participant_profiles=context["participant_profiles"],
        historical_meetings=context["historical_meetings"],
        related_documents=context["related_documents"],
        pending_todos=context["pending_todos"],
        related_chats=context["related_chats"],
    )
