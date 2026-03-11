"""领导风格洞察分析服务。"""

import json
import logging
from collections.abc import AsyncGenerator
from datetime import datetime

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.communication import Communication
from app.models.document import Document
from app.models.leadership_insight import LeadershipInsight
from app.models.user import User
from app.services.llm import llm_client

logger = logging.getLogger(__name__)

LEADERSHIP_ANALYSIS_PROMPT = """你是一位专业的员工画像分析师。请根据以下数据分析目标员工的工作风格特征。

## 目标员工: {target_name}

## 数据
{data}

注意：数据中带有 "tags" 字段的条目是用户主动标记的分类，反映了用户的关注重点。请在分析中优先考虑这些有标签的数据，并参考标签揭示的主题归属。

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

    # 从沟通记录中找发起人（initiator）
    comm_result = await db.execute(
        select(Communication.initiator, func.count(Communication.id)).where(
            and_(Communication.owner_id == owner_id, Communication.initiator.isnot(None))
        ).group_by(Communication.initiator)
    )
    for name, count in comm_result.all():
        if name:
            if name not in candidates:
                candidates[name] = {"name": name, "comm_count": 0, "document_count": 0}
            candidates[name]["comm_count"] = count

    # 从文档中找作者
    doc_result = await db.execute(
        select(Document.author, func.count(Document.id)).where(
            and_(Document.owner_id == owner_id, Document.author.isnot(None))
        ).group_by(Document.author)
    )
    for name, count in doc_result.all():
        if name:
            if name not in candidates:
                candidates[name] = {"name": name, "comm_count": 0, "document_count": 0}
            candidates[name]["document_count"] = count

    # 获取所有内部用户名集合
    user_result = await db.execute(select(User.name).where(User.name.isnot(None)))
    internal_names = {row[0] for row in user_result.all() if row[0]}

    # 标记内部/外部
    for c in candidates.values():
        c["is_internal"] = c["name"] in internal_names

    # 按总数据量排序
    result = sorted(
        candidates.values(),
        key=lambda x: x["comm_count"] + x["document_count"],
        reverse=True,
    )
    return result[:50]


async def _query_content_tags(
    db: AsyncSession,
    content_type: str,
    content_ids: list[int],
) -> dict[int, list[str]]:
    """批量查询内容关联的标签名称。"""
    if not content_ids:
        return {}
    from app.models.tag import ContentTag, TagDefinition
    result = await db.execute(
        select(ContentTag.content_id, TagDefinition.name)
        .join(TagDefinition, TagDefinition.id == ContentTag.tag_id)
        .where(
            and_(
                ContentTag.content_type == content_type,
                ContentTag.content_id.in_(content_ids),
            )
        )
    )
    tag_map: dict[int, list[str]] = {}
    for row in result.all():
        tag_map.setdefault(row[0], []).append(row[1])
    return tag_map


async def gather_leader_data(
    db: AsyncSession,
    owner_id: str,
    target_name: str,
) -> dict:
    """收集目标领导的相关数据，附带标签信息。"""
    data: dict = {"communications": [], "documents": []}

    # 沟通记录（作为发起人）
    comms = await db.execute(
        select(Communication).where(
            and_(
                Communication.owner_id == owner_id,
                Communication.initiator == target_name,
            )
        ).order_by(Communication.comm_time.desc().nullslast()).limit(100)
    )
    comm_list = comms.scalars().all()
    comm_tags = await _query_content_tags(db, "communication", [c.id for c in comm_list])
    for c in comm_list:
        data["communications"].append({
            "type": c.comm_type,
            "title": c.title,
            "time": str(c.comm_time or c.created_at),
            "duration": c.duration_minutes,
            "conclusions": c.conclusions,
            "content": c.content_text[:300] if c.content_text else "",
            "participants_count": len(c.participants) if c.participants else 0,
            "tags": comm_tags.get(c.id, []),
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
    doc_list = documents.scalars().all()
    doc_tags = await _query_content_tags(db, "document", [d.id for d in doc_list])
    for d in doc_list:
        data["documents"].append({
            "title": d.title,
            "keywords": d.keywords,
            "summary": d.summary,
            "created": str(d.created_at),
            "tags": doc_tags.get(d.id, []),
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
            "communications": len(data["communications"]),
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
            "communications": len(data["communications"]),
            "documents": len(data["documents"]),
        },
    )
    db.add(insight)
    await db.commit()
    await db.refresh(insight)

    yield json.dumps({"type": "insight_id", "id": insight.id}, ensure_ascii=False)

    full_content = []
    try:
        from app.services.llm import create_openai_client
        client = create_openai_client(
            api_key=settings.agent_llm_api_key,
            base_url=settings.agent_llm_base_url,
            timeout=120.0,
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
