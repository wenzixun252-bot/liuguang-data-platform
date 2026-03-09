"""知识图谱构建服务 — LLM提取实体和关系。"""

import json
import logging
from datetime import datetime

from sqlalchemy import select, and_, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.communication import Communication
from app.models.document import Document
from app.models.content_entity_link import ContentEntityLink
from app.models.knowledge_graph import KGEntity, KGRelation
from app.services.llm import llm_client

logger = logging.getLogger(__name__)

EXTRACT_KG_PROMPT = """你是一个知识图谱构建专家。请从以下文本中提取实体和关系。

## 文本内容
{content}

## 实体类型
- person: 人物
- project: 项目
- topic: 主题/话题
- organization: 组织/部门
- event: 事件
- document: 文档
- community: 社群/群组/团队

## 关系类型
- collaborates_with: 合作关系（person ↔ person）
- works_on: 参与项目（person → project）
- discusses: 讨论话题（person → topic）
- belongs_to: 隶属（person → organization）
- related_to: 通用关联

## 输出格式（JSON）
{{
  "entities": [
    {{"name": "实体名", "type": "person", "properties": {{}}}}
  ],
  "relations": [
    {{"source": "实体名1", "target": "实体名2", "type": "collaborates_with"}}
  ]
}}

只输出 JSON，不要输出其他内容。"""


async def build_knowledge_graph(
    db: AsyncSession,
    owner_id: str,
    incremental: bool = True,
) -> dict:
    """构建或增量更新知识图谱。"""
    # 获取需要处理的数据
    texts = await _gather_texts(db, owner_id, incremental)

    if not texts:
        return {"entities_added": 0, "relations_added": 0, "message": "没有新数据需要处理"}

    # 批量处理文本
    all_entities: list[dict] = []
    all_relations: list[dict] = []

    # 跟踪实体名 -> 来源内容，用于创建锚定链接
    entity_content_map: dict[str, list[dict]] = {}

    for text_chunk in texts:
        extracted = await _llm_extract_kg(text_chunk["content"])
        for e in extracted.get("entities", []):
            e["_source_time"] = text_chunk.get("time")
            # 记录实体来源
            ename = e.get("name", "").strip()
            if ename and text_chunk.get("content_type"):
                entity_content_map.setdefault(ename, []).append({
                    "content_type": text_chunk["content_type"],
                    "content_id": text_chunk["content_id"],
                    "snippet": text_chunk["content"][:200],
                })
        all_entities.extend(extracted.get("entities", []))
        all_relations.extend(extracted.get("relations", []))

    # 去重合并实体
    entities_added = await _merge_entities(db, owner_id, all_entities)
    relations_added = await _merge_relations(db, owner_id, all_relations)

    # 创建内容-实体锚定链接
    links_added = await _create_entity_links(db, owner_id, entity_content_map)

    await db.commit()

    return {
        "entities_added": entities_added,
        "relations_added": relations_added,
        "links_added": links_added,
        "texts_processed": len(texts),
    }


async def _gather_texts(
    db: AsyncSession,
    owner_id: str,
    incremental: bool,
) -> list[dict]:
    """收集需要处理的文本。"""
    texts = []

    # 如果是增量更新，只处理最近更新的
    if incremental:
        # 获取上次构建时间
        result = await db.execute(
            select(func.max(KGEntity.updated_at)).where(KGEntity.owner_id == owner_id)
        )
        last_build = result.scalar()
        if last_build:
            # 确保 naive datetime
            time_filter = last_build.replace(tzinfo=None) if last_build.tzinfo else last_build
        else:
            time_filter = datetime(2020, 1, 1)
    else:
        time_filter = datetime(2020, 1, 1)

    # 文档
    docs = await db.execute(
        select(Document).where(
            and_(Document.owner_id == owner_id, Document.updated_at > time_filter)
        ).limit(100)
    )
    for doc in docs.scalars().all():
        texts.append({
            "content": f"文档标题: {doc.title}\n内容: {doc.content_text[:2000]}",
            "time": str(doc.created_at),
            "content_type": "document",
            "content_id": doc.id,
        })

    # 沟通记录（会议 + 会话 + 录音）
    comms = await db.execute(
        select(Communication).where(
            and_(Communication.owner_id == owner_id, Communication.updated_at > time_filter)
        ).order_by(Communication.comm_time.desc().nullslast()).limit(200)
    )
    for c in comms.scalars().all():
        if c.comm_type == "meeting" or c.comm_type == "recording":
            participants_str = json.dumps(c.participants, ensure_ascii=False) if c.participants else "[]"
            texts.append({
                "content": f"会议: {c.title}\n参会人: {participants_str}\n内容: {c.content_text[:2000]}",
                "time": str(c.comm_time or c.created_at),
                "content_type": "communication",
                "content_id": c.id,
            })
        elif c.comm_type == "chat":
            texts.append({
                "content": f"聊天记录 [{c.initiator}]: {c.content_text[:2000]}",
                "time": str(c.comm_time or c.created_at),
                "content_type": "communication",
                "content_id": c.id,
            })

    return texts


async def _llm_extract_kg(content: str) -> dict:
    """调用LLM提取实体和关系。"""
    prompt = EXTRACT_KG_PROMPT.format(content=content[:4000])

    try:
        response = await llm_client.chat_client.chat.completions.create(
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
        return json.loads(result_text)
    except Exception as e:
        logger.warning("LLM提取知识图谱失败: %s", e)
        return {"entities": [], "relations": []}


async def _create_entity_links(
    db: AsyncSession,
    owner_id: str,
    entity_content_map: dict[str, list[dict]],
) -> int:
    """根据提取的实体创建内容-实体锚定链接。"""
    added = 0
    for entity_name, sources in entity_content_map.items():
        # 查找对应实体
        result = await db.execute(
            select(KGEntity).where(
                and_(KGEntity.owner_id == owner_id, KGEntity.name == entity_name)
            )
        )
        entity = result.scalar_one_or_none()
        if not entity:
            continue

        for src in sources:
            # 检查是否已存在
            existing = await db.execute(
                select(ContentEntityLink).where(
                    and_(
                        ContentEntityLink.entity_id == entity.id,
                        ContentEntityLink.content_type == src["content_type"],
                        ContentEntityLink.content_id == src["content_id"],
                    )
                )
            )
            if existing.scalar_one_or_none():
                continue

            db.add(ContentEntityLink(
                entity_id=entity.id,
                content_type=src["content_type"],
                content_id=src["content_id"],
                relation_type="mentioned_in",
                context_snippet=src.get("snippet"),
            ))
            added += 1

    return added


async def _merge_entities(
    db: AsyncSession,
    owner_id: str,
    entities: list[dict],
) -> int:
    """去重合并实体，累加 mention_count。"""
    added = 0
    for e in entities:
        name = e.get("name", "").strip()
        entity_type = e.get("type", "topic")
        if not name:
            continue

        # 查找已存在的实体
        result = await db.execute(
            select(KGEntity).where(
                and_(
                    KGEntity.owner_id == owner_id,
                    KGEntity.name == name,
                    KGEntity.entity_type == entity_type,
                )
            )
        )
        existing = result.scalar_one_or_none()

        source_time = e.get("_source_time")
        now = datetime.utcnow()
        parsed_time = None
        if source_time:
            try:
                dt = datetime.fromisoformat(source_time)
                # 确保 naive datetime（去掉 tzinfo）
                parsed_time = dt.replace(tzinfo=None)
            except (ValueError, TypeError):
                pass

        if existing:
            existing.mention_count += 1
            existing.last_seen_at = parsed_time or now
            if e.get("properties"):
                merged = {**existing.properties, **e["properties"]}
                existing.properties = merged
        else:
            entity = KGEntity(
                owner_id=owner_id,
                name=name,
                entity_type=entity_type,
                properties=e.get("properties", {}),
                mention_count=1,
                first_seen_at=parsed_time or now,
                last_seen_at=parsed_time or now,
            )
            db.add(entity)
            added += 1

    return added


async def _merge_relations(
    db: AsyncSession,
    owner_id: str,
    relations: list[dict],
) -> int:
    """去重合并关系，累加 weight。"""
    added = 0
    for r in relations:
        source_name = r.get("source", "").strip()
        target_name = r.get("target", "").strip()
        rel_type = r.get("type", "related_to")

        if not source_name or not target_name:
            continue

        # 查找源和目标实体
        src_result = await db.execute(
            select(KGEntity).where(
                and_(KGEntity.owner_id == owner_id, KGEntity.name == source_name)
            )
        )
        src = src_result.scalar_one_or_none()

        tgt_result = await db.execute(
            select(KGEntity).where(
                and_(KGEntity.owner_id == owner_id, KGEntity.name == target_name)
            )
        )
        tgt = tgt_result.scalar_one_or_none()

        if not src or not tgt:
            continue

        # 查找已存在的关系
        rel_result = await db.execute(
            select(KGRelation).where(
                and_(
                    KGRelation.owner_id == owner_id,
                    KGRelation.source_entity_id == src.id,
                    KGRelation.target_entity_id == tgt.id,
                    KGRelation.relation_type == rel_type,
                )
            )
        )
        existing_rel = rel_result.scalar_one_or_none()

        if existing_rel:
            existing_rel.weight += 1
        else:
            relation = KGRelation(
                owner_id=owner_id,
                source_entity_id=src.id,
                target_entity_id=tgt.id,
                relation_type=rel_type,
                weight=1,
                evidence_sources=[],
            )
            db.add(relation)
            added += 1

    return added
