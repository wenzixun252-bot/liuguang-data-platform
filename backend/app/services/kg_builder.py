"""知识图谱构建服务 — LLM提取实体和关系。"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select, and_, case, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.communication import Communication
from app.models.document import Document
from app.models.content_entity_link import ContentEntityLink
from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.tag import ContentTag, TagDefinition
from app.services.llm import llm_client

if TYPE_CHECKING:
    from app.models.kg_profile import KGProfile

logger = logging.getLogger(__name__)


def _normalize_entity_name(name: str) -> str:
    """归一化实体名：去首尾空白、ASCII 转小写、去包裹符号。

    例如：
      "Claude" -> "claude"
      "「流光项目」" -> "流光项目"
      " API " -> "api"
    """
    name = name.strip()
    # 去除常见包裹符号（可嵌套，循环剥离）
    changed = True
    while changed:
        changed = False
        for left, right in [('「', '」'), ('【', '】'), ('"', '"'), ("'", "'"), ('"', '"'), ('(', ')'), ('（', '）')]:
            if len(name) >= 2 and name.startswith(left) and name.endswith(right):
                name = name[1:-1].strip()
                changed = True
    # ASCII 部分统一小写（中文字符无大小写，保持不变）
    return "".join(ch.lower() if ch.isascii() else ch for ch in name)

def _build_extract_prompt(content: str, profile: KGProfile | None = None) -> str:
    """构建 LLM 提取 prompt，可选注入用户背景。"""
    parts = ["你是一个知识图谱构建专家。请从以下文本中提取**有意义的**实体和关系。\n"]

    # 注入用户背景
    if profile and (profile.user_name or profile.user_role):
        focus_people = "、".join(profile.focus_people) if profile.focus_people else "无"
        focus_projects = "、".join(profile.focus_projects) if profile.focus_projects else "无"
        parts.append(
            f"## 用户背景（请特别关注与此人相关的实体和关系）\n"
            f"- 姓名：{profile.user_name}，职位：{profile.user_role}，部门：{profile.user_department}\n"
            f"- 工作职责：{profile.user_description}\n"
            f"- 重点关注的人物：{focus_people}\n"
            f"- 重点关注的项目：{focus_projects}\n\n"
            f"请在提取时优先识别与以上背景相关的内容。如果文本中提到了以上人物或项目，务必提取。\n"
        )

    parts.append(
        f"## 文本内容\n{content}\n\n"
        '## 实体类型（仅以下2种，不要提取其他类型）\n'
        '- person: 具体的人物（必须是明确的人名，如"张明"、"李娜"）\n'
        '- item: 具体的事项（项目、话题、事件、组织等有明确名称的事物，如"流光项目"、"产品评审会"、"数据安全"、"产品部"）\n\n'
        '## 关系类型\n'
        '- collaborates_with: 合作关系（person ↔ person）\n'
        '- involved_in: 参与/关联（person → item，或 item → item）\n'
        '- related_to: 通用关联\n\n'
        '## 不要提取\n'
        '- 代词（如"大家"、"他们"、"我们"、"这个"、"那个"）\n'
        '- 泛化词（如"工作"、"项目"、"问题"、"方案"，除非有具体名称修饰）\n'
        '- 单个字的实体\n'
        '- 动词或形容词（如"讨论"、"重要"）\n'
        '- 角色描述（如"负责人"、"开发者"，除非是具体人名）\n\n'
        '## 示例\n'
        '输入："周三的产品评审会上，张明和李娜讨论了流光项目的V2方案，决定下周启动开发。"\n\n'
        '输出：\n'
        '{\n'
        '  "entities": [\n'
        '    {"name": "张明", "type": "person", "properties": {}},\n'
        '    {"name": "李娜", "type": "person", "properties": {}},\n'
        '    {"name": "流光项目", "type": "item", "properties": {"phase": "V2"}},\n'
        '    {"name": "产品评审会", "type": "item", "properties": {}}\n'
        '  ],\n'
        '  "relations": [\n'
        '    {"source": "张明", "target": "流光项目", "type": "involved_in"},\n'
        '    {"source": "李娜", "target": "流光项目", "type": "involved_in"},\n'
        '    {"source": "张明", "target": "李娜", "type": "collaborates_with"}\n'
        '  ]\n'
        '}\n\n'
        '## 输出格式（JSON）\n'
        '只输出 JSON，不要输出其他内容。如果文本中没有有意义的实体，返回 {"entities": [], "relations": []}'
    )

    return "\n".join(parts)


async def build_knowledge_graph(
    db: AsyncSession,
    owner_id: str,
    incremental: bool = True,
    on_progress: "Callable[[int, int], None] | None" = None,
    profile: KGProfile | None = None,
    clean_rebuild: bool = False,
) -> dict:
    """构建或增量更新知识图谱。

    clean_rebuild=True 时，会在所有 LLM 提取完成后、写入前删除旧数据，
    确保旧图谱在构建成功之前一直保留。
    """
    # 获取需要处理的数据
    texts = await _gather_texts(db, owner_id, incremental, profile)

    if not texts:
        return {"entities_added": 0, "relations_added": 0, "message": "没有新数据需要处理"}

    # 批量处理文本
    all_entities: list[dict] = []
    all_relations: list[dict] = []

    # 跟踪实体名 -> 来源内容，用于创建锚定链接
    entity_content_map: dict[str, list[dict]] = {}

    # 并发调用 LLM，每批 15 个
    BATCH_SIZE = 15
    total = len(texts)
    processed = 0

    for i in range(0, total, BATCH_SIZE):
        batch = texts[i:i + BATCH_SIZE]
        tasks = [_llm_extract_kg(t["content"], profile) for t in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for text_chunk, extracted in zip(batch, results):
            if isinstance(extracted, Exception):
                logger.warning("LLM提取失败: %s", extracted)
                extracted = {"entities": [], "relations": []}
            for e in extracted.get("entities", []):
                e["_source_time"] = text_chunk.get("time")
                ename = e.get("name", "").strip()
                if ename and text_chunk.get("content_type"):
                    entity_content_map.setdefault(ename, []).append({
                        "content_type": text_chunk["content_type"],
                        "content_id": text_chunk["content_id"],
                        "snippet": text_chunk["content"][:200],
                    })
            all_entities.extend(extracted.get("entities", []))
            all_relations.extend(extracted.get("relations", []))

        processed += len(batch)
        if on_progress:
            on_progress(processed, total)

    # 从标签注入实体和关系
    tag_entity_names: set[str] = set()
    for text_chunk in texts:
        chunk_tags = text_chunk.get("tags", [])
        chunk_entities = [e.get("name", "").strip() for e in all_entities if e.get("name")]
        for tag in chunk_tags:
            if tag["category"] in ("project", "topic"):
                tag_name = tag["name"]
                tag_entity_names.add(tag_name)
                all_entities.append({
                    "name": tag_name,
                    "type": "item",
                    "properties": {"from_tag": True, "tag_category": tag["category"]},
                    "_source_time": text_chunk.get("time"),
                })
                # 为该文本块中提取出的 person 实体建立 tagged_with 关系
                for ename in chunk_entities:
                    # 只给 person 类型建关系（避免 item-item 重复噪声）
                    matching = [e for e in all_entities if e.get("name") == ename and e.get("type") == "person"]
                    if matching:
                        all_relations.append({
                            "source": ename,
                            "target": tag_name,
                            "type": "involved_in",
                        })

    # 注入种子实体（来自用户 profile 的重点人物和项目）
    if profile:
        if profile.user_name:
            all_entities.append({"name": profile.user_name, "type": "person", "properties": {"seed": True}})
        if profile.user_department:
            all_entities.append({"name": profile.user_department, "type": "item", "properties": {"seed": True}})
        for p in (profile.focus_people or []):
            if p.strip():
                all_entities.append({"name": p.strip(), "type": "person", "properties": {"seed": True}})
        for p in (profile.focus_projects or []):
            if p.strip():
                all_entities.append({"name": p.strip(), "type": "item", "properties": {"seed": True}})

    # clean_rebuild: LLM 提取全部成功后，删除旧数据再写入新数据
    if clean_rebuild:
        from sqlalchemy import delete as sa_delete
        await db.execute(
            sa_delete(ContentEntityLink).where(
                ContentEntityLink.entity_id.in_(
                    select(KGEntity.id).where(KGEntity.owner_id == owner_id)
                )
            )
        )
        await db.execute(sa_delete(KGRelation).where(KGRelation.owner_id == owner_id))
        await db.execute(sa_delete(KGEntity).where(KGEntity.owner_id == owner_id))
        await db.flush()
        logger.info("clean_rebuild: 旧图谱数据已清理，准备写入新数据 (owner=%s)", owner_id)

    # 模糊去重：归一化名称 + 子串合并（在写入 DB 之前处理内存中的列表）
    all_entities, all_relations = _deduplicate_entity_list(all_entities, all_relations)

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



def _format_tags_for_prompt(tags: list[dict]) -> str:
    """将标签格式化为 LLM 提示文本。"""
    if not tags:
        return ""
    tag_strs = [f"[{t['category']}]{t['name']}" for t in tags]
    return f"\n标签: {', '.join(tag_strs)}"


def _format_key_info(key_info: dict | None) -> str:
    """将自定义提取的 key_info 格式化为 LLM 提示文本，帮助图谱更精准地识别实体。"""
    if not key_info:
        return ""
    lines = []
    for k, v in key_info.items():
        if v is not None and str(v).strip():
            lines.append(f"- {k}: {v}")
    if not lines:
        return ""
    return "\n已提取关键信息:\n" + "\n".join(lines)


async def _batch_fetch_content_tags(
    db: AsyncSession,
    content_type: str,
    content_ids: list[int],
) -> dict[int, list[dict]]:
    """批量查询多条内容的标签，返回 {content_id: [{"name": ..., "category": ...}, ...]}。"""
    if not content_ids:
        return {}
    result = await db.execute(
        select(ContentTag.content_id, TagDefinition.name, TagDefinition.category)
        .join(ContentTag, ContentTag.tag_id == TagDefinition.id)
        .where(
            and_(
                ContentTag.content_type == content_type,
                ContentTag.content_id.in_(content_ids),
            )
        )
    )
    tag_map: dict[int, list[dict]] = {}
    for row in result.fetchall():
        tag_map.setdefault(row[0], []).append({"name": row[1], "category": row[2]})
    return tag_map


async def _gather_texts(
    db: AsyncSession,
    owner_id: str,
    incremental: bool,
    profile: KGProfile | None = None,
) -> list[dict]:
    """收集需要处理的文本，根据 profile 过滤数据源和时间范围。"""
    texts = []

    # 确定数据源和时间范围
    data_sources = (profile.data_sources if profile and profile.data_sources else ["document", "meeting", "chat"])
    time_range_days = profile.time_range_days if profile else 0

    # 计算时间过滤
    if incremental:
        result = await db.execute(
            select(func.max(KGEntity.updated_at)).where(KGEntity.owner_id == owner_id)
        )
        last_build = result.scalar()
        if last_build:
            time_filter = last_build.replace(tzinfo=None) if last_build.tzinfo else last_build
        else:
            time_filter = datetime(2020, 1, 1)
    elif time_range_days and time_range_days > 0:
        time_filter = datetime.utcnow() - timedelta(days=time_range_days)
    else:
        time_filter = datetime(2020, 1, 1)

    # 文档 — 智能时间过滤：飞书文档用创建/修改时间，本地文档用上传时间
    if "document" in data_sources:
        doc_eff_time = case(
            (Document.source_type == "cloud",
             func.coalesce(Document.feishu_created_at, Document.feishu_updated_at, Document.created_at)),
            else_=Document.created_at,
        )
        docs = await db.execute(
            select(Document).where(
                and_(Document.owner_id == owner_id, doc_eff_time > time_filter)
            ).limit(100)
        )
        doc_list = docs.scalars().all()
        doc_tags_map = await _batch_fetch_content_tags(db, "document", [d.id for d in doc_list])
        for doc in doc_list:
            tags = doc_tags_map.get(doc.id, [])
            tag_text = _format_tags_for_prompt(tags)
            key_info_text = _format_key_info(doc.key_info)
            texts.append({
                "content": f"文档标题: {doc.title}{tag_text}{key_info_text}\n内容: {doc.content_text[:2000]}",
                "time": str(doc.feishu_created_at or doc.created_at),
                "content_type": "document",
                "content_id": doc.id,
                "tags": tags,
            })

    # 沟通记录（会议 + 会话 + 录音）— 用 comm_time 过滤
    include_meeting = "meeting" in data_sources
    include_chat = "chat" in data_sources

    if include_meeting or include_chat:
        comm_eff_time = func.coalesce(Communication.comm_time, Communication.created_at)
        comms = await db.execute(
            select(Communication).where(
                and_(Communication.owner_id == owner_id, comm_eff_time > time_filter)
            ).order_by(Communication.comm_time.desc().nullslast()).limit(200)
        )
        comm_list = comms.scalars().all()
        comm_tags_map = await _batch_fetch_content_tags(db, "communication", [c.id for c in comm_list])
        for c in comm_list:
            tags = comm_tags_map.get(c.id, [])
            tag_text = _format_tags_for_prompt(tags)
            key_info_text = _format_key_info(c.key_info)
            if include_meeting and c.comm_type in ("meeting", "recording"):
                participants_str = json.dumps(c.participants, ensure_ascii=False) if c.participants else "[]"
                texts.append({
                    "content": f"会议: {c.title}{tag_text}{key_info_text}\n参会人: {participants_str}\n内容: {c.content_text[:2000]}",
                    "time": str(c.comm_time or c.created_at),
                    "content_type": "communication",
                    "content_id": c.id,
                    "tags": tags,
                })
            elif include_chat and c.comm_type == "chat":
                texts.append({
                    "content": f"聊天记录 [{c.initiator}]{tag_text}{key_info_text}: {c.content_text[:2000]}",
                    "time": str(c.comm_time or c.created_at),
                    "content_type": "communication",
                    "content_id": c.id,
                    "tags": tags,
                })

    return texts


async def _llm_extract_kg(content: str, profile: KGProfile | None = None) -> dict:
    """调用LLM提取实体和关系。"""
    prompt = _build_extract_prompt(content[:4000], profile)

    try:
        response = await llm_client.chat_client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
        )
        result_text = response.choices[0].message.content if response.choices else None
        if not result_text:
            logger.warning("LLM提取知识图谱: 返回内容为空")
            return {"entities": [], "relations": []}
        result_text = result_text.strip()
        if "```" in result_text:
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
            result_text = result_text.strip()
        return json.loads(result_text)
    except Exception as e:
        logger.warning("LLM提取知识图谱失败: %s (type=%s)", e, type(e).__name__)
        return {"entities": [], "relations": []}


async def _create_entity_links(
    db: AsyncSession,
    owner_id: str,
    entity_content_map: dict[str, list[dict]],
) -> int:
    """根据提取的实体创建内容-实体锚定链接。预加载已有数据避免逐条查询。"""
    # 预加载该用户所有实体（按 name 索引）
    ent_result = await db.execute(
        select(KGEntity).where(KGEntity.owner_id == owner_id)
    )
    # 用归一化名称索引实体
    entity_by_norm_name: dict[str, KGEntity] = {}
    for ent in ent_result.scalars().all():
        entity_by_norm_name[_normalize_entity_name(ent.name)] = ent

    # 收集所有相关 entity_id 以批量加载已有链接
    relevant_ids = [
        ent.id for norm, ent in entity_by_norm_name.items()
        if any(_normalize_entity_name(n) == norm for n in entity_content_map)
    ]

    # 预加载已有链接（按 (entity_id, content_type, content_id) 索引）
    existing_links: set[tuple[int, str, int]] = set()
    if relevant_ids:
        link_result = await db.execute(
            select(
                ContentEntityLink.entity_id,
                ContentEntityLink.content_type,
                ContentEntityLink.content_id,
            ).where(ContentEntityLink.entity_id.in_(relevant_ids))
        )
        for row in link_result.fetchall():
            existing_links.add((row[0], row[1], row[2]))

    added = 0
    for entity_name, sources in entity_content_map.items():
        entity = entity_by_norm_name.get(_normalize_entity_name(entity_name))
        if not entity:
            continue

        for src in sources:
            key = (entity.id, src["content_type"], src["content_id"])
            if key in existing_links:
                continue

            db.add(ContentEntityLink(
                entity_id=entity.id,
                content_type=src["content_type"],
                content_id=src["content_id"],
                relation_type="mentioned_in",
                context_snippet=src.get("snippet"),
            ))
            existing_links.add(key)
            added += 1

    return added


# 实体名停用词表：这些词不应作为实体存储
_ENTITY_STOPWORDS = {
    "大家", "他们", "我们", "你们", "这个", "那个", "所有人", "团队", "负责人",
    "工作", "项目", "问题", "方案", "内容", "情况", "部分", "方面", "东西",
    "讨论", "会议", "事情", "任务", "目标", "计划", "进展", "结果", "总结",
}


def _is_valid_entity(name: str) -> bool:
    """检查实体名是否有效。"""
    if len(name) <= 1:
        return False
    if name in _ENTITY_STOPWORDS:
        return False
    # 过滤纯数字、纯标点
    if name.isdigit():
        return False
    return True


def _deduplicate_entity_list(
    entities: list[dict],
    relations: list[dict],
) -> tuple[list[dict], list[dict]]:
    """对 LLM 提取的实体列表做模糊去重，同时更新关系中的名称引用。

    策略：
    1. 归一化后完全相同 → 合并（解决大小写、包裹符号差异）
    2. 同类型 + 一个名称是另一个的子串 + 长度比 >= 0.6 → 合并到更高频名称
       （解决 "文样句" vs "样句" 这类部分重复）

    返回：(去重后的 entities, 更新名称后的 relations)
    """
    from collections import Counter

    # 统计每个原始名出现的频次
    name_freq: Counter = Counter()
    for e in entities:
        name = e.get("name", "").strip()
        if name:
            name_freq[name] += 1

    # 按 (entity_type, normalized_name) 分组
    type_norm_groups: dict[str, dict[str, set[str]]] = {}
    for e in entities:
        name = e.get("name", "").strip()
        etype = e.get("type", "item")
        if not name:
            continue
        norm = _normalize_entity_name(name)
        type_norm_groups.setdefault(etype, {}).setdefault(norm, set()).add(name)

    canonical_map: dict[str, str] = {}  # 原始名 → 规范名

    # ── 第 1 步：归一化后完全相同的，选频次最高的作为规范名 ──
    for etype, norm_dict in type_norm_groups.items():
        for norm_name, originals in norm_dict.items():
            if len(originals) <= 1:
                continue
            best = max(originals, key=lambda n: name_freq[n])
            for orig in originals:
                if orig != best:
                    canonical_map[orig] = best

    # ── 第 2 步：同类型子串匹配 ──
    for etype, norm_dict in type_norm_groups.items():
        norm_names = list(norm_dict.keys())
        for i in range(len(norm_names)):
            for j in range(i + 1, len(norm_names)):
                n1, n2 = norm_names[i], norm_names[j]
                shorter, longer = (n1, n2) if len(n1) <= len(n2) else (n2, n1)
                # 太短的名称不做子串匹配（避免 "AI" 匹配 "AI工具开发" 这类误合并）
                if len(shorter) < 2:
                    continue
                if shorter not in longer:
                    continue
                # 长度比要求 >= 0.6（"样句"(2) vs "文样句"(3) = 0.67 ✓，"数据"(2) vs "数据安全治理"(6) = 0.33 ✗）
                if len(shorter) / len(longer) < 0.6:
                    continue

                # 两组都取各自频次最高的原始名
                originals_s = norm_dict[shorter]
                originals_l = norm_dict[longer]
                freq_s = sum(name_freq[n] for n in originals_s)
                freq_l = sum(name_freq[n] for n in originals_l)

                # 以高频侧的最佳名称为规范名
                if freq_s >= freq_l:
                    canon = max(originals_s, key=lambda n: name_freq[n])
                    for orig in originals_l:
                        canonical_map.setdefault(orig, canon)
                else:
                    canon = max(originals_l, key=lambda n: name_freq[n])
                    for orig in originals_s:
                        canonical_map.setdefault(orig, canon)

    if not canonical_map:
        return entities, relations

    logger.info("实体模糊去重映射 (%d 条): %s", len(canonical_map), canonical_map)

    # 应用映射
    for e in entities:
        name = e.get("name", "").strip()
        if name in canonical_map:
            e["name"] = canonical_map[name]

    for r in relations:
        src = r.get("source", "").strip()
        tgt = r.get("target", "").strip()
        if src in canonical_map:
            r["source"] = canonical_map[src]
        if tgt in canonical_map:
            r["target"] = canonical_map[tgt]

    return entities, relations


async def _merge_entities(
    db: AsyncSession,
    owner_id: str,
    entities: list[dict],
) -> int:
    """去重合并实体，累加 mention_count。预加载已有实体避免逐条查询。"""
    # 一次性加载该用户所有已有实体到内存字典
    result = await db.execute(
        select(KGEntity).where(KGEntity.owner_id == owner_id)
    )
    existing_map: dict[tuple[str, str], KGEntity] = {}
    for ent in result.scalars().all():
        # 用归一化名称作为 key，这样新提取的实体能匹配到旧的 DB 记录
        existing_map[(_normalize_entity_name(ent.name), ent.entity_type)] = ent

    added = 0
    for e in entities:
        name = e.get("name", "").strip()
        entity_type = e.get("type", "item")
        if not name or not _is_valid_entity(name):
            continue

        norm_name = _normalize_entity_name(name)

        source_time = e.get("_source_time")
        now = datetime.utcnow()
        parsed_time = None
        if source_time:
            try:
                dt = datetime.fromisoformat(source_time)
                parsed_time = dt.replace(tzinfo=None)
            except (ValueError, TypeError):
                pass

        existing = existing_map.get((norm_name, entity_type))
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
            existing_map[(norm_name, entity_type)] = entity
            added += 1

    return added


async def _merge_relations(
    db: AsyncSession,
    owner_id: str,
    relations: list[dict],
) -> int:
    """去重合并关系，累加 weight。预加载已有数据避免逐条查询。"""
    # 预加载该用户所有实体（按 name 索引）
    ent_result = await db.execute(
        select(KGEntity).where(KGEntity.owner_id == owner_id)
    )
    # 用归一化名称索引，确保关系能匹配到归一化后的实体
    entity_by_norm_name: dict[str, KGEntity] = {}
    for ent in ent_result.scalars().all():
        entity_by_norm_name[_normalize_entity_name(ent.name)] = ent

    # 预加载该用户所有已有关系（按 (src_id, tgt_id, type) 索引）
    rel_result = await db.execute(
        select(KGRelation).where(KGRelation.owner_id == owner_id)
    )
    existing_rels: dict[tuple[int, int, str], KGRelation] = {}
    for rel in rel_result.scalars().all():
        existing_rels[(rel.source_entity_id, rel.target_entity_id, rel.relation_type)] = rel

    added = 0
    for r in relations:
        source_name = r.get("source", "").strip()
        target_name = r.get("target", "").strip()
        rel_type = r.get("type", "related_to")

        if not source_name or not target_name:
            continue

        src = entity_by_norm_name.get(_normalize_entity_name(source_name))
        tgt = entity_by_norm_name.get(_normalize_entity_name(target_name))
        if not src or not tgt:
            continue

        key = (src.id, tgt.id, rel_type)
        existing_rel = existing_rels.get(key)

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
            existing_rels[key] = relation
            added += 1

    return added
