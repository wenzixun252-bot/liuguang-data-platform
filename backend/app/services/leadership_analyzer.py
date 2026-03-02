"""领导风格洞察分析服务。"""

import json
import logging
from collections.abc import AsyncGenerator
from datetime import datetime

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.chat_message import ChatMessage
from app.models.document import Document
from app.models.meeting import Meeting
from app.models.leadership_insight import LeadershipInsight
from app.services.llm import llm_client

logger = logging.getLogger(__name__)

LEADERSHIP_ANALYSIS_PROMPT = """你是一位专业的员工画像分析师。请根据以下数据分析目标员工的工作风格特征。

## 目标员工: {target_name}

## 数据
{data}

## 分析维度（每个维度给出1-10分评分和简短分析）
1. **沟通偏好**: 沟通方式、频率、偏好的沟通渠道
2. **决策模式**: 决策速度、是否民主、数据驱动程度
3. **关注领域**: 主要关注的业务领域和话题
4. **会议习惯**: 会议频率、时长偏好、是否注重结论和行动项
5. **响应速度**: 消息回复速度、任务跟进及时性
6. **沟通建议**: 基于以上分析，给出与该员工高效沟通协作的建议评分（越高表示沟通协作越顺畅）

## 输出要求
请输出完整的分析报告（Markdown格式），包含：
1. 总体评价（2-3句话总结该员工的工作风格）
2. 各维度详细分析
3. **沟通建议**：针对如何与该员工高效协作，提供3-5条具体可操作的沟通建议

同时在报告末尾，用 JSON 代码块输出各维度的数值评分：
```json
{{"communication": 8, "decision_making": 7, "focus_areas": 9, "meeting_habits": 6, "responsiveness": 8, "collaboration_advice": 7}}
```
"""


async def get_leadership_candidates(
    db: AsyncSession,
    owner_id: str,
) -> list[dict]:
    """获取可分析的领导候选人列表。"""
    candidates: dict[str, dict] = {}

    # 从会议中找组织者
    meeting_result = await db.execute(
        select(Meeting.organizer, func.count(Meeting.id)).where(
            and_(Meeting.owner_id == owner_id, Meeting.organizer.isnot(None))
        ).group_by(Meeting.organizer)
    )
    for name, count in meeting_result.all():
        if name:
            if name not in candidates:
                candidates[name] = {"name": name, "meeting_count": 0, "message_count": 0, "document_count": 0}
            candidates[name]["meeting_count"] = count

    # 从聊天消息中找发送者
    msg_result = await db.execute(
        select(ChatMessage.sender, func.count(ChatMessage.id)).where(
            and_(ChatMessage.owner_id == owner_id, ChatMessage.sender.isnot(None))
        ).group_by(ChatMessage.sender)
    )
    for name, count in msg_result.all():
        if name:
            if name not in candidates:
                candidates[name] = {"name": name, "meeting_count": 0, "message_count": 0, "document_count": 0}
            candidates[name]["message_count"] = count

    # 从文档中找作者
    doc_result = await db.execute(
        select(Document.author, func.count(Document.id)).where(
            and_(Document.owner_id == owner_id, Document.author.isnot(None))
        ).group_by(Document.author)
    )
    for name, count in doc_result.all():
        if name:
            if name not in candidates:
                candidates[name] = {"name": name, "meeting_count": 0, "message_count": 0, "document_count": 0}
            candidates[name]["document_count"] = count

    # 按总数据量排序
    result = sorted(
        candidates.values(),
        key=lambda x: x["meeting_count"] + x["message_count"] + x["document_count"],
        reverse=True,
    )
    return result[:50]


async def gather_leader_data(
    db: AsyncSession,
    owner_id: str,
    target_name: str,
) -> dict:
    """收集目标领导的相关数据。"""
    data: dict = {"meetings": [], "messages": [], "documents": []}

    # 会议（作为组织者或参与者）
    meetings = await db.execute(
        select(Meeting).where(
            and_(
                Meeting.owner_id == owner_id,
                Meeting.organizer == target_name,
            )
        ).order_by(Meeting.meeting_time.desc()).limit(30)
    )
    for m in meetings.scalars().all():
        data["meetings"].append({
            "title": m.title,
            "time": str(m.meeting_time),
            "duration": m.duration_minutes,
            "conclusions": m.conclusions,
            "action_items": m.action_items,
            "participants_count": len(m.participants) if m.participants else 0,
        })

    # 聊天消息
    messages = await db.execute(
        select(ChatMessage).where(
            and_(
                ChatMessage.owner_id == owner_id,
                ChatMessage.sender == target_name,
            )
        ).order_by(ChatMessage.sent_at.desc()).limit(100)
    )
    for m in messages.scalars().all():
        data["messages"].append({
            "content": m.content_text[:300],
            "time": str(m.sent_at),
            "type": m.message_type,
        })

    # 文档
    documents = await db.execute(
        select(Document).where(
            and_(
                Document.owner_id == owner_id,
                Document.author == target_name,
            )
        ).order_by(Document.created_at.desc()).limit(20)
    )
    for d in documents.scalars().all():
        data["documents"].append({
            "title": d.title,
            "category": d.category,
            "summary": d.summary,
            "created": str(d.created_at),
        })

    return data


async def generate_insight(
    db: AsyncSession,
    analyst_user_id: str,
    target_user_id: str,
    target_user_name: str,
) -> LeadershipInsight:
    """生成领导风格洞察（非流式）。"""
    data = await gather_leader_data(db, analyst_user_id, target_user_name)
    data_text = json.dumps(data, ensure_ascii=False, indent=2)

    prompt = LEADERSHIP_ANALYSIS_PROMPT.format(
        target_name=target_user_name,
        data=data_text[:8000],
    )

    insight = LeadershipInsight(
        analyst_user_id=analyst_user_id,
        target_user_id=target_user_id,
        target_user_name=target_user_name,
        data_coverage={
            "meetings": len(data["meetings"]),
            "messages": len(data["messages"]),
            "documents": len(data["documents"]),
        },
    )
    db.add(insight)
    await db.commit()
    await db.refresh(insight)

    try:
        response = await llm_client.chat_client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        content = response.choices[0].message.content
        insight.report_markdown = content

        # 尝试提取维度评分
        dimensions = _extract_dimensions(content)
        insight.dimensions = dimensions
        insight.generated_at = datetime.utcnow()
    except Exception as e:
        logger.error("领导洞察生成失败: %s", e)
        insight.report_markdown = f"分析失败: {e}"

    await db.commit()
    await db.refresh(insight)
    return insight


async def generate_insight_stream(
    db: AsyncSession,
    analyst_user_id: str,
    target_user_id: str,
    target_user_name: str,
) -> AsyncGenerator[str, None]:
    """流式生成领导风格洞察。"""
    data = await gather_leader_data(db, analyst_user_id, target_user_name)
    data_text = json.dumps(data, ensure_ascii=False, indent=2)

    prompt = LEADERSHIP_ANALYSIS_PROMPT.format(
        target_name=target_user_name,
        data=data_text[:8000],
    )

    insight = LeadershipInsight(
        analyst_user_id=analyst_user_id,
        target_user_id=target_user_id,
        target_user_name=target_user_name,
        data_coverage={
            "meetings": len(data["meetings"]),
            "messages": len(data["messages"]),
            "documents": len(data["documents"]),
        },
    )
    db.add(insight)
    await db.commit()
    await db.refresh(insight)

    yield json.dumps({"type": "insight_id", "id": insight.id}, ensure_ascii=False)

    full_content = []
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            api_key=settings.agent_llm_api_key,
            base_url=settings.agent_llm_base_url,
        )
        stream = await client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                full_content.append(delta.content)
                yield json.dumps({"type": "content", "content": delta.content}, ensure_ascii=False)

        content = "".join(full_content)
        insight.report_markdown = content
        insight.dimensions = _extract_dimensions(content)
        insight.generated_at = datetime.utcnow()
        await db.commit()

        yield json.dumps({"type": "done", "insight_id": insight.id, "dimensions": insight.dimensions}, ensure_ascii=False)
    except Exception as e:
        logger.error("流式领导洞察生成失败: %s", e)
        await db.commit()
        yield json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False)


def _extract_dimensions(content: str) -> dict:
    """从报告内容中提取维度评分 JSON。"""
    try:
        if "```json" in content:
            json_block = content.split("```json")[1].split("```")[0].strip()
            return json.loads(json_block)
        elif "```" in content:
            parts = content.split("```")
            for part in parts[1::2]:
                try:
                    return json.loads(part.strip())
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass
    return {}
