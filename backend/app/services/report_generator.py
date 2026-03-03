"""报告生成服务 — 从个人知识库生成报告。"""

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
from app.models.report import Report, ReportTemplate
from app.services.llm import llm_client

logger = logging.getLogger(__name__)

# 预设系统模板
SYSTEM_TEMPLATES = [
    {
        "name": "周报",
        "description": "自动汇总本周工作，生成标准周报",
        "prompt_template": """请根据以下数据，为用户生成一份周报。

## 数据内容
{data}

## 输出结构
### 本周工作总结
（汇总本周主要工作成果）

### 重点会议与决策
（列出重要会议及关键决策）

### 产出成果
（具体产出物、文档、成果）

### 下周计划
（基于当前进展推断下周重点）

{extra_instructions}

请用专业简洁的中文撰写，使用 Markdown 格式。""",
        "output_structure": {
            "sections": ["本周工作总结", "重点会议与决策", "产出成果", "下周计划"]
        },
    },
    {
        "name": "月报",
        "description": "自动汇总月度工作，生成月度报告",
        "prompt_template": """请根据以下数据，为用户生成一份月度报告。

## 数据内容
{data}

## 输出结构
### 月度目标回顾
（本月主要目标和完成情况）

### 重点项目进展
（各项目的进展状态和成果）

### 关键会议决策
（重要会议及其决策和影响）

### 数据分析
（关键数据指标和趋势分析）

{extra_instructions}

请用专业简洁的中文撰写，使用 Markdown 格式。""",
        "output_structure": {
            "sections": ["月度目标回顾", "重点项目进展", "关键会议决策", "数据分析"]
        },
    },
    {
        "name": "项目总结",
        "description": "自动汇总项目相关数据，生成项目总结报告",
        "prompt_template": """请根据以下数据，为用户生成一份项目总结报告。

## 数据内容
{data}

## 输出结构
### 项目背景
（项目的背景和目标）

### 完成情况
（各阶段的完成状态和成果）

### 经验教训
（过程中的问题、挑战和解决方案）

### 后续计划
（未完成事项和后续安排）

{extra_instructions}

请用专业简洁的中文撰写，使用 Markdown 格式。""",
        "output_structure": {
            "sections": ["项目背景", "完成情况", "经验教训", "后续计划"]
        },
    },
]


async def ensure_system_templates(db: AsyncSession) -> None:
    """确保系统预设模板存在。"""
    result = await db.execute(
        select(func.count()).select_from(ReportTemplate).where(
            ReportTemplate.template_type == "system"
        )
    )
    count = result.scalar()
    if count and count >= len(SYSTEM_TEMPLATES):
        return

    for tpl in SYSTEM_TEMPLATES:
        existing = await db.execute(
            select(ReportTemplate).where(
                and_(
                    ReportTemplate.name == tpl["name"],
                    ReportTemplate.template_type == "system",
                )
            )
        )
        if existing.scalar_one_or_none():
            continue

        db.add(ReportTemplate(
            name=tpl["name"],
            template_type="system",
            prompt_template=tpl["prompt_template"],
            output_structure=tpl["output_structure"],
            description=tpl["description"],
        ))

    await db.commit()


async def gather_data(
    db: AsyncSession,
    owner_id: str,
    time_start: datetime,
    time_end: datetime,
    data_sources: list[str],
) -> dict:
    """从三表按时间范围收集用户数据。"""
    # 三表列为 TIMESTAMP WITHOUT TIME ZONE，需要 naive datetime
    if time_start.tzinfo is not None:
        time_start = time_start.replace(tzinfo=None)
    if time_end.tzinfo is not None:
        time_end = time_end.replace(tzinfo=None)

    data: dict = {"documents": [], "meetings": [], "chat_messages": []}

    if "document" in data_sources:
        result = await db.execute(
            select(Document).where(
                and_(
                    Document.owner_id == owner_id,
                    Document.created_at >= time_start,
                    Document.created_at <= time_end,
                )
            ).order_by(Document.created_at.desc()).limit(50)
        )
        docs = result.scalars().all()
        data["documents"] = [
            {"title": d.title, "content": d.content_text[:500], "created": str(d.created_at)}
            for d in docs
        ]

    if "meeting" in data_sources:
        result = await db.execute(
            select(Meeting).where(
                and_(
                    Meeting.owner_id == owner_id,
                    Meeting.created_at >= time_start,
                    Meeting.created_at <= time_end,
                )
            ).order_by(Meeting.created_at.desc()).limit(50)
        )
        meetings = result.scalars().all()
        data["meetings"] = [
            {
                "title": m.title,
                "time": str(m.meeting_time),
                "organizer": m.organizer,
                "conclusions": m.conclusions,
                "action_items": m.action_items,
                "content": m.content_text[:500],
            }
            for m in meetings
        ]

    if "chat_message" in data_sources:
        result = await db.execute(
            select(ChatMessage).where(
                and_(
                    ChatMessage.owner_id == owner_id,
                    ChatMessage.created_at >= time_start,
                    ChatMessage.created_at <= time_end,
                )
            ).order_by(ChatMessage.sent_at.desc()).limit(100)
        )
        messages = result.scalars().all()
        data["chat_messages"] = [
            {"sender": m.sender, "content": m.content_text[:300], "time": str(m.sent_at)}
            for m in messages
        ]

    return data


async def _build_reader_context(db: AsyncSession, owner_id: str, reader_ids: list[str]) -> str:
    """构建阅读者画像上下文，注入到 LLM prompt 中。"""
    if not reader_ids:
        return ""

    from app.models.knowledge_graph import KGEntity, KGRelation
    from app.models.leadership_insight import LeadershipInsight

    reader_profiles = []
    for reader_name in reader_ids:
        profile_parts = []

        # 从知识图谱查找此人的关联
        entity_result = await db.execute(
            select(KGEntity).where(and_(
                KGEntity.owner_id == owner_id,
                KGEntity.entity_type == "person",
                KGEntity.name == reader_name,
            )).limit(1)
        )
        entity = entity_result.scalar_one_or_none()

        if entity:
            # 获取其关联的项目和话题
            from sqlalchemy import or_
            rel_result = await db.execute(
                select(KGRelation).where(and_(
                    KGRelation.owner_id == owner_id,
                    or_(
                        KGRelation.source_entity_id == entity.id,
                        KGRelation.target_entity_id == entity.id,
                    ),
                )).limit(20)
            )
            rels = rel_result.scalars().all()
            related_ids = set()
            for r in rels:
                related_ids.add(r.source_entity_id)
                related_ids.add(r.target_entity_id)
            related_ids.discard(entity.id)

            if related_ids:
                re_result = await db.execute(
                    select(KGEntity).where(KGEntity.id.in_(related_ids))
                )
                for re in re_result.scalars().all():
                    if re.entity_type == "project":
                        profile_parts.append(f"关注项目: {re.name}")
                    elif re.entity_type == "topic":
                        profile_parts.append(f"关注话题: {re.name}")

        # 查找领导力洞察
        insight_result = await db.execute(
            select(LeadershipInsight)
            .where(LeadershipInsight.target_user_name == reader_name)
            .order_by(LeadershipInsight.generated_at.desc())
            .limit(1)
        )
        insight = insight_result.scalar_one_or_none()
        if insight and insight.report_markdown:
            profile_parts.append(f"风格特点: {insight.report_markdown[:200]}")

        if profile_parts:
            reader_profiles.append(f"- {reader_name}: {'; '.join(profile_parts)}")
        else:
            reader_profiles.append(f"- {reader_name}")

    return "\n\n## 报告阅读者画像\n以下是本报告的目标阅读者信息，请根据他们的关注点和偏好来调整报告内容的侧重：\n" + "\n".join(reader_profiles) + "\n"


async def generate_report(
    db: AsyncSession,
    owner_id: str,
    template_id: int,
    title: str,
    time_start: datetime,
    time_end: datetime,
    data_sources: list[str],
    extra_instructions: str | None = None,
    target_reader_ids: list[str] | None = None,
) -> Report:
    """生成报告（非流式）。"""
    # 确保 naive datetime（三表和 reports 表都是 TIMESTAMP WITHOUT TIME ZONE）
    if time_start.tzinfo is not None:
        time_start = time_start.replace(tzinfo=None)
    if time_end.tzinfo is not None:
        time_end = time_end.replace(tzinfo=None)

    # 获取模板
    template = await db.get(ReportTemplate, template_id)
    if not template:
        raise ValueError("模板不存在")

    # 收集数据
    data = await gather_data(db, owner_id, time_start, time_end, data_sources)

    # 构建阅读者上下文
    reader_context = await _build_reader_context(db, owner_id, target_reader_ids or [])

    # 构建 prompt
    data_text = json.dumps(data, ensure_ascii=False, indent=2)
    prompt = template.prompt_template.format(
        data=data_text[:8000],
        extra_instructions=(extra_instructions or "") + reader_context,
    )

    # 创建报告记录
    report = Report(
        owner_id=owner_id,
        template_id=template_id,
        title=title,
        status="generating",
        time_range_start=time_start,
        time_range_end=time_end,
        target_readers=target_reader_ids or [],
        data_sources_used={
            "sources": data_sources,
            "counts": {
                "documents": len(data["documents"]),
                "meetings": len(data["meetings"]),
                "chat_messages": len(data["chat_messages"]),
            },
        },
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    try:
        response = await llm_client.chat_client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        content = response.choices[0].message.content
        report.content_markdown = content
        report.status = "completed"
    except Exception as e:
        logger.error("报告生成失败: %s", e)
        report.status = "failed"
        report.content_markdown = f"生成失败: {e}"

    await db.commit()
    await db.refresh(report)
    return report


async def generate_report_stream(
    db: AsyncSession,
    owner_id: str,
    template_id: int,
    title: str,
    time_start: datetime,
    time_end: datetime,
    data_sources: list[str],
    extra_instructions: str | None = None,
    target_reader_ids: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """流式生成报告（SSE）。"""
    if time_start.tzinfo is not None:
        time_start = time_start.replace(tzinfo=None)
    if time_end.tzinfo is not None:
        time_end = time_end.replace(tzinfo=None)

    template = await db.get(ReportTemplate, template_id)
    if not template:
        yield json.dumps({"type": "error", "content": "模板不存在"}, ensure_ascii=False)
        return

    data = await gather_data(db, owner_id, time_start, time_end, data_sources)

    # 构建阅读者上下文
    reader_context = await _build_reader_context(db, owner_id, target_reader_ids or [])

    data_text = json.dumps(data, ensure_ascii=False, indent=2)
    prompt = template.prompt_template.format(
        data=data_text[:8000],
        extra_instructions=(extra_instructions or "") + reader_context,
    )

    # 创建报告记录
    report = Report(
        owner_id=owner_id,
        template_id=template_id,
        title=title,
        status="generating",
        time_range_start=time_start,
        time_range_end=time_end,
        target_readers=target_reader_ids or [],
        data_sources_used={
            "sources": data_sources,
            "counts": {
                "documents": len(data["documents"]),
                "meetings": len(data["meetings"]),
                "chat_messages": len(data["chat_messages"]),
            },
        },
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    # 发送报告 ID
    yield json.dumps({"type": "report_id", "id": report.id}, ensure_ascii=False)

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

        report.content_markdown = "".join(full_content)
        report.status = "completed"
        await db.commit()

        yield json.dumps({"type": "done", "report_id": report.id}, ensure_ascii=False)
    except Exception as e:
        logger.error("流式报告生成失败: %s", e)
        report.status = "failed"
        await db.commit()
        yield json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False)
