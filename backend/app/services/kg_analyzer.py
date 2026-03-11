"""知识图谱分析服务 — 业务域识别、重要性评分、业务风险提取、LLM 总结。"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta

import networkx as nx
from sqlalchemy import select, and_, or_, update, delete, cast
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.llm import create_openai_client
from app.models.content_entity_link import ContentEntityLink
from app.models.knowledge_graph import KGEntity, KGRelation

logger = logging.getLogger(__name__)

MAX_ANALYSIS_NODES = 500

# ── 实体类型 → 业务域名称映射（回退用） ──
# 注意：person 不映射到"人力资源"，因为人物存在于所有业务域中，
# 仅靠 person 类型无法判断具体业务领域
_TYPE_TO_DOMAIN = {
    "organization": "商务合作",
    "project": "项目管理",
    "technology": "技术研发",
    "product": "产品管理",
    "event": "活动管理",
    "location": "行政后勤",
    "concept": "战略规划",
}


def _infer_domain_from_types(type_dist: dict, idx: int, top_entities: list[str] | None = None) -> str:
    """根据实体类型分布推断业务域名称（作为 LLM 命名失败时的回退）。

    策略：先用非 person 类型映射；person 主导的社群用序号区分。
    绝不用人名命名，避免域名看起来像 "团队" 划分。
    """
    if not type_dist:
        return f"业务领域{idx + 1}"

    # 按数量排序，优先找非 person/item 类型
    sorted_types = sorted(type_dist.items(), key=lambda x: x[1], reverse=True)

    # 先尝试用非 person 的具体类型来命名
    for t, count in sorted_types:
        if t != "person" and t != "item":
            label = _TYPE_TO_DOMAIN.get(t)
            if label:
                return label

    # person/item 主导的社群 → 用通用职能占位名（等待 LLM 覆盖）
    _GENERIC_DOMAIN_NAMES = ["综合事务", "协作职能", "业务推进", "运营支持", "战略规划", "专项工作"]
    return _GENERIC_DOMAIN_NAMES[idx % len(_GENERIC_DOMAIN_NAMES)]


def _validate_domain_label(label: str, top_entities: list[str]) -> bool:
    """校验 LLM 返回的 domain_label 是否为合格的职能类型名称。"""
    if not label or len(label) < 2 or len(label) > 12:
        return False
    # 不能包含实体名（避免人名、项目名拼凑）——只检查长度>=2的实体名
    for entity_name in top_entities:
        if len(entity_name) >= 2 and entity_name in label:
            return False
    # 不能包含明显的拼接符号
    if " · " in label or "·" in label:
        return False
    return True


# ── 类型权重映射 ──
_TYPE_WEIGHTS = {
    "person": 1.0,
    "item": 0.9,
}


async def _load_graph(db: AsyncSession, owner_id: str) -> tuple[list, list, nx.Graph]:
    """从数据库加载实体和关系，构建 NetworkX 图。"""
    entity_result = await db.execute(
        select(KGEntity)
        .where(KGEntity.owner_id == owner_id)
        .order_by(KGEntity.mention_count.desc())
        .limit(MAX_ANALYSIS_NODES)
    )
    entities = entity_result.scalars().all()
    entity_ids = {e.id for e in entities}

    relations = []
    if entity_ids:
        rel_result = await db.execute(
            select(KGRelation).where(
                and_(
                    KGRelation.owner_id == owner_id,
                    KGRelation.source_entity_id.in_(entity_ids),
                    KGRelation.target_entity_id.in_(entity_ids),
                )
            )
        )
        relations = rel_result.scalars().all()

    G = nx.Graph()
    for e in entities:
        G.add_node(e.id, name=e.name, entity_type=e.entity_type, mention_count=e.mention_count)
    for r in relations:
        if G.has_edge(r.source_entity_id, r.target_entity_id):
            G[r.source_entity_id][r.target_entity_id]["weight"] += r.weight
        else:
            G.add_edge(r.source_entity_id, r.target_entity_id, weight=r.weight)

    return entities, relations, G


# ═══════════════════════════════════════════════════════════════════
# 1. 社群检测 + 业务域标签
# ═══════════════════════════════════════════════════════════════════

async def detect_communities(db: AsyncSession, owner_id: str, entities: list = None, relations: list = None, G: nx.Graph = None, profile=None) -> list[dict]:
    """运行 Louvain 社群检测 + LLM 业务域命名。"""
    if entities is None or G is None:
        entities, relations, G = await _load_graph(db, owner_id)
    if relations is None:
        _, relations, _ = await _load_graph(db, owner_id)

    if len(G.nodes) < 2:
        return []

    communities_iter = nx.algorithms.community.louvain_communities(G, weight="weight", seed=42)
    communities = list(communities_iter)

    entity_map = {e.id: e for e in entities}
    result = []
    for idx, member_ids in enumerate(communities):
        await db.execute(
            update(KGEntity)
            .where(and_(KGEntity.owner_id == owner_id, KGEntity.id.in_(member_ids)))
            .values(community_id=idx)
        )

        members = [entity_map[mid] for mid in member_ids if mid in entity_map]
        members.sort(key=lambda e: e.mention_count, reverse=True)
        top_members = members[:10]
        top_names = [m.name for m in top_members[:3]]
        label = " · ".join(top_names)

        # 收集社群内的关系信息（实体A -关系类型-> 实体B）
        community_relations = []
        for r in relations:
            if r.source_entity_id in member_ids and r.target_entity_id in member_ids:
                src = entity_map.get(r.source_entity_id)
                tgt = entity_map.get(r.target_entity_id)
                if src and tgt:
                    community_relations.append(
                        f"{src.name}({src.entity_type}) -{r.relation_type}-> {tgt.name}({tgt.entity_type})"
                    )

        # 收集社群内实体的内容片段（增强：更多片段、更长内容）
        community_snippets = []
        top_member_ids = [m.id for m in top_members[:8]]
        if top_member_ids:
            snippet_result = await db.execute(
                select(ContentEntityLink.context_snippet, ContentEntityLink.entity_id)
                .where(ContentEntityLink.entity_id.in_(top_member_ids))
                .order_by(ContentEntityLink.id.desc())
                .limit(20)
            )
            for row in snippet_result.all():
                if row.context_snippet:
                    community_snippets.append(row.context_snippet[:300])

        # 统计实体类型分布
        type_counts = defaultdict(int)
        for m in members:
            type_counts[m.entity_type] += 1

        # 收集 item 实体名称列表（项目名、话题名本身携带业务语义）
        item_names = [m.name for m in members if m.entity_type == "item"][:10]

        result.append({
            "community_id": idx,
            "member_count": len(member_ids),
            "top_entities": top_names,
            "label": label,
            "domain_label": _infer_domain_from_types(dict(type_counts), idx, top_names),
            "member_ids": list(member_ids),
            "_top_members_detail": [
                {"name": m.name, "type": m.entity_type} for m in top_members
            ],
            "_relations_summary": community_relations[:15],
            "_content_snippets": community_snippets[:10],
            "_item_names": item_names,
            "_type_distribution": dict(type_counts),
        })

    await db.commit()

    # LLM 业务域命名（传入用户 profile 提供业务背景）
    result = await _label_domains_via_llm(result, profile=profile)

    # 去重：如果多个社群被命名为相同的域名，追加区分标识
    result = _deduplicate_domain_labels(result)

    # 将 domain_label 写入每个实体的 properties JSONB，供 graph_rag 使用
    for c in result:
        if c.get("member_ids") and c.get("domain_label"):
            from sqlalchemy import type_coerce
            patch_dict = {"domain_label": c["domain_label"]}
            await db.execute(
                update(KGEntity)
                .where(KGEntity.id.in_(c["member_ids"]))
                .values(
                    properties=KGEntity.properties.concat(type_coerce(patch_dict, PG_JSONB))
                )
            )
    await db.commit()
    logger.info("domain_label 已写入 %d 个社群的实体 properties", len(result))

    return result


async def _label_domains_via_llm(communities: list[dict], profile=None) -> list[dict]:
    """用 LLM 为每个社群分配业务域名称，根据 profile.domain_mode 动态调整策略。"""
    if not settings.agent_llm_api_key or not communities:
        return communities

    client = create_openai_client(
        api_key=settings.agent_llm_api_key,
        base_url=settings.agent_llm_base_url,
        timeout=120.0,
    )

    # 构建 payload（增强：加入 item_names 和更多 snippets）
    payload = []
    for c in communities:
        payload.append({
            "community_id": c["community_id"],
            "member_count": c["member_count"],
            "type_distribution": c.get("_type_distribution", {}),
            "members": c.get("_top_members_detail", []),
            "item_names": c.get("_item_names", []),
            "key_relations": c.get("_relations_summary", [])[:10],
            "content_snippets": c.get("_content_snippets", [])[:8],
        })

    # 读取用户分类偏好
    domain_mode = getattr(profile, "domain_mode", "function") if profile else "function"
    custom_domains = getattr(profile, "custom_domains", []) if profile else []

    # 根据 domain_mode 构建分类指令
    if domain_mode == "custom" and custom_domains:
        mode_instruction = (
            f"用户已定义了以下业务域：{', '.join(custom_domains)}\n"
            "请将每个群组归入最匹配的用户自定义域。如果都不匹配，可以新建一个简短的域名。"
        )
    elif domain_mode == "project":
        mode_instruction = (
            "请根据群组涉及的主要项目或事项来命名业务域。\n"
            "域名应该是项目名或事项主题，如「流光项目」「数据看板」「季度审计」等。\n"
            "优先参考群组中 item_names 字段的名称。"
        )
    elif domain_mode == "collaboration":
        mode_instruction = (
            "请根据群组的协作团队或协作关系来命名业务域。\n"
            "域名应体现协作对象，如「投资部协作」「技术团队」「外部合作」等。"
        )
    elif domain_mode == "content_type":
        mode_instruction = (
            "请根据内容的类型和场景来命名业务域。\n"
            "域名应体现信息场景，如「会议决策」「文档沉淀」「日常沟通」「审批流程」等。"
        )
    else:  # function（默认）
        mode_instruction = (
            "请根据群组涉及的工作职能来命名业务域。\n"
            "域名应是具体的职能领域，如「数据治理」「投资分析」「AI工具开发」「财务管理」「日常沟通」等。\n"
            "严禁在域名中使用任何人名！不要出现「XX团队」「XX组」这种以人名命名的格式。\n"
            "即使群组以人物实体为主，也必须根据 content_snippets、key_relations、item_names 中反映的工作内容来判断具体职能。"
        )

    # 自定义域名作为参考提示（非custom模式下）
    if custom_domains and domain_mode != "custom":
        mode_instruction += f"\n用户希望重点关注这些领域：{', '.join(custom_domains)}，请优先使用这些名称。"

    # 构建用户背景
    profile_context = ""
    if profile:
        parts = []
        if getattr(profile, "user_name", None):
            parts.append(f"姓名：{profile.user_name}")
        if getattr(profile, "user_role", None):
            parts.append(f"职位：{profile.user_role}")
        if getattr(profile, "user_department", None):
            parts.append(f"部门：{profile.user_department}")
        if getattr(profile, "user_description", None):
            parts.append(f"工作职责：{profile.user_description}")
        if parts:
            profile_context = "\n## 用户背景\n" + "\n".join("- " + p for p in parts)

    prompt = f"""你是企业数据分析专家。以下是从企业知识图谱中用社群检测算法分出的实体群组。
请为每个群组分配一个业务域名称。
{profile_context}

## 分类策略
{mode_instruction}

## 要求
- 域名长度 2-6 个中文字，简洁有辨识度
- 每个群组必须有**不同的**域名称，严禁重复
- 严禁在域名中包含任何人名（如群组成员的姓名），域名必须体现职能/业务/领域
- 如果群组确实跨多个职能且无法归类，用「综合事务」

## 群组数据
{json.dumps(payload, ensure_ascii=False, indent=2)}

严格按JSON格式输出，不要输出其他内容：
[{{"community_id": 0, "domain_label": "域名称"}}]"""

    try:
        response = await client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=800,
        )
        content = response.choices[0].message.content.strip()
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        labels = json.loads(content)
        logger.info("LLM 业务域命名返回: %s", json.dumps(labels, ensure_ascii=False))
        label_map = {item["community_id"]: item["domain_label"] for item in labels}

        # project/custom 模式下放宽验证（允许包含项目名）
        relaxed = domain_mode in ("project", "custom")
        for c in communities:
            llm_label = label_map.get(c["community_id"])
            top_ents = [] if relaxed else c.get("top_entities", [])
            if llm_label and _validate_domain_label(llm_label, top_ents):
                c["domain_label"] = llm_label
                logger.info("社群 %d 采用 LLM 命名: %s", c["community_id"], llm_label)
            else:
                logger.warning(
                    "社群 %d LLM 命名被拒或缺失 (llm=%s), 保留回退: %s",
                    c["community_id"], llm_label, c["domain_label"],
                )
    except Exception as e:
        logger.error("LLM 业务域命名失败: %s", e, exc_info=True)

    return communities


def _deduplicate_domain_labels(communities: list[dict]) -> list[dict]:
    """去重业务域名称：如果多个社群同名，用核心实体名区分。"""
    # 统计每个 domain_label 出现的次数
    label_counts: dict[str, list[int]] = defaultdict(list)
    for i, c in enumerate(communities):
        label_counts[c.get("domain_label", "")].append(i)

    for label, indices in label_counts.items():
        if len(indices) <= 1:
            continue
        # 有重复，用序号区分（不使用人名）
        for rank, idx in enumerate(indices, 1):
            communities[idx]["domain_label"] = f"{label}{rank}"

    return communities


# ═══════════════════════════════════════════════════════════════════
# 2. 重要性评分
# ═══════════════════════════════════════════════════════════════════

async def compute_importance_scores(db: AsyncSession, owner_id: str, entities: list, G: nx.Graph) -> None:
    """计算每个实体的重要性评分并写回数据库。"""
    if len(G.nodes) < 2:
        return

    degree = nx.degree_centrality(G)

    # 归一化 mention_count
    max_mention = max((e.mention_count for e in entities), default=1)
    if max_mention == 0:
        max_mention = 1

    # 归一化 degree centrality
    max_degree = max(degree.values(), default=1)
    if max_degree == 0:
        max_degree = 1

    # 时效性基准：最近 30 天内为满分，逐渐衰减
    now = datetime.utcnow()
    recency_window = timedelta(days=90)

    for e in entities:
        mention_norm = e.mention_count / max_mention
        degree_norm = degree.get(e.id, 0) / max_degree

        # 时效性评分
        if e.last_seen_at:
            last_seen = e.last_seen_at.replace(tzinfo=None) if e.last_seen_at.tzinfo else e.last_seen_at
            age = now - last_seen
            recency = max(0.0, 1.0 - (age / recency_window))
        else:
            recency = 0.0

        type_weight = _TYPE_WEIGHTS.get(e.entity_type, 0.5)

        score = mention_norm * 0.4 + degree_norm * 0.3 + recency * 0.2 + type_weight * 0.1
        e.importance_score = round(score, 4)

    await db.execute(
        update(KGEntity)
        .where(KGEntity.owner_id == owner_id)
        .values(importance_score=0.0)
    )

    for e in entities:
        await db.execute(
            update(KGEntity)
            .where(KGEntity.id == e.id)
            .values(importance_score=e.importance_score)
        )

    await db.commit()


# ═══════════════════════════════════════════════════════════════════
# 3. 指标计算
# ═══════════════════════════════════════════════════════════════════

def compute_metrics(G: nx.Graph, entities: list) -> dict:
    """计算图谱核心指标。"""
    if len(G.nodes) < 2:
        return {"top_connectors": [], "top_bridges": [], "hot_items": [], "isolated": []}

    degree = nx.degree_centrality(G)
    betweenness = nx.betweenness_centrality(G, weight="weight")

    entity_map = {e.id: e for e in entities}

    top_connectors = sorted(degree.items(), key=lambda x: x[1], reverse=True)[:10]
    top_connectors = [
        {"id": nid, "name": entity_map[nid].name, "type": entity_map[nid].entity_type, "score": round(score, 4)}
        for nid, score in top_connectors if nid in entity_map
    ]

    top_bridges = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)[:10]
    top_bridges = [
        {"id": nid, "name": entity_map[nid].name, "type": entity_map[nid].entity_type, "score": round(score, 4)}
        for nid, score in top_bridges if nid in entity_map
    ]

    hot_items = []
    for nid in G.nodes:
        e = entity_map.get(nid)
        if e and e.entity_type == "item":
            total_weight = sum(d.get("weight", 1) for _, _, d in G.edges(nid, data=True))
            hot_items.append({"id": nid, "name": e.name, "weight_sum": total_weight})
    hot_items.sort(key=lambda x: x["weight_sum"], reverse=True)
    hot_items = hot_items[:10]

    isolated = [
        {"id": nid, "name": entity_map[nid].name, "type": entity_map[nid].entity_type}
        for nid in G.nodes if G.degree(nid) <= 1 and nid in entity_map
    ]

    return {
        "top_connectors": top_connectors,
        "top_bridges": top_bridges,
        "hot_items": hot_items,
        "isolated": isolated,
    }


# ═══════════════════════════════════════════════════════════════════
# 4. 业务风险提取（替代旧的图结构风险检测）
# ═══════════════════════════════════════════════════════════════════

async def extract_business_risks(
    db: AsyncSession,
    owner_id: str,
    entities: list,
    G: nx.Graph,
) -> list[dict]:
    """从实体关联的内容中提取业务语义风险。"""
    if not settings.agent_llm_api_key:
        logger.warning("agent_llm_api_key 未配置，降级为结构风险检测")
        return _detect_structural_risks(G, entities)

    # 取重要性 Top 30 实体
    sorted_entities = sorted(entities, key=lambda e: e.importance_score, reverse=True)[:30]

    # 加载每个实体最近的内容片段
    entities_with_context = []
    entity_map = {e.id: e for e in entities}
    for e in sorted_entities:
        snippets = await db.execute(
            select(ContentEntityLink.context_snippet, ContentEntityLink.content_type)
            .where(ContentEntityLink.entity_id == e.id)
            .order_by(ContentEntityLink.id.desc())
            .limit(3)
        )
        snippet_list = [
            {"text": row.context_snippet, "source": row.content_type}
            for row in snippets.all()
            if row.context_snippet
        ]

        # 收集关联实体
        neighbors = []
        for neighbor_id in list(G.neighbors(e.id))[:5] if e.id in G else []:
            ne = entity_map.get(neighbor_id)
            if ne:
                neighbors.append({"name": ne.name, "type": ne.entity_type})

        entities_with_context.append({
            "id": e.id,
            "name": e.name,
            "type": e.entity_type,
            "mention_count": e.mention_count,
            "related_entities": neighbors,
            "content_snippets": snippet_list,
        })

    if not entities_with_context:
        return []

    client = create_openai_client(
        api_key=settings.agent_llm_api_key,
        base_url=settings.agent_llm_base_url,
        timeout=120.0,
    )

    prompt = f"""你是企业风险分析专家。根据以下知识图谱核心实体及其关联内容片段，识别具体的业务风险。

## 实体数据（按重要性排序的前30个核心实体）
{json.dumps(entities_with_context, ensure_ascii=False, indent=2)}

## 风险类别（每类识别0-3条，总计不超过8条，只提取有明确证据支撑的风险）
1. **project**（项目风险）：进度滞后、需求长期未推进、里程碑延迟、关键交付物缺失
2. **compliance**（合规风险）：审批流程未完成、文档缺失合规审查、制度执行不到位
3. **collaboration**（协作风险）：关键任务仅一人负责、跨部门沟通断层、信息不对称
4. **resource**（资源风险）：关键人员过载（参与过多项目）、职责不清、资源分配不均

## 输出格式（JSON数组，不要输出其他内容）
[
  {{
    "category": "project|compliance|collaboration|resource",
    "title": "具体风险标题（如：XX项目V2进度滞后）",
    "description": "1-2句话描述风险详情",
    "severity": "high|medium|low",
    "evidence": "支撑该风险判断的关键证据摘要",
    "suggested_action": "建议的应对措施",
    "related_entity_ids": [相关实体ID列表]
  }}
]

要求：
- 每条风险必须有具体的实体名称，不要泛泛而谈
- 只输出有内容证据支撑的风险，不要臆测
- severity 要根据影响范围和紧急程度判断
- 用中文输出"""

    try:
        response = await client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=3000,
        )
        content = response.choices[0].message.content.strip()
        logger.info("LLM 风险原始返回 (%d chars): %s", len(content), content[:200])
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        risks = json.loads(content)
        logger.info("LLM 风险解析成功: %d 条", len(risks))

        # 标准化输出格式，硬限制最多 8 条
        formatted = []
        for r in risks[:8]:
            formatted.append({
                "title": r.get("title", ""),
                "description": r.get("description", ""),
                "type": "risk",
                "severity": r.get("severity", "medium"),
                "related_entity_ids": r.get("related_entity_ids", []),
                "category": r.get("category", ""),
                "evidence": r.get("evidence", ""),
                "suggested_action": r.get("suggested_action", ""),
            })
        return formatted
    except json.JSONDecodeError as e:
        logger.error("LLM 风险 JSON 解析失败: %s, 原始内容: %s", e, content[:500])
        return _detect_structural_risks(G, entities)
    except Exception as e:
        logger.error("LLM 业务风险提取失败: %s: %s", type(e).__name__, e, exc_info=True)
        return _detect_structural_risks(G, entities)


def _detect_structural_risks(G: nx.Graph, entities: list) -> list[dict]:
    """降级方案：基于图结构检测风险（当 LLM 不可用时）。"""
    entity_map = {e.id: e for e in entities}
    risks = []

    # 模式1：资源过载 — person 连接 >= 3 个 item 且权重高
    for nid in G.nodes:
        e = entity_map.get(nid)
        if not e or e.entity_type != "person":
            continue
        connected_items = []
        for neighbor in G.neighbors(nid):
            ne = entity_map.get(neighbor)
            if ne and ne.entity_type == "item":
                w = G[nid][neighbor].get("weight", 1)
                if w >= 2:
                    connected_items.append(ne)
        if len(connected_items) >= 3:
            item_names = ", ".join(p.name for p in connected_items[:5])
            risks.append({
                "title": f"资源过载风险：{e.name}",
                "description": f"{e.name} 同时深度参与 {len(connected_items)} 个事项（{item_names}），存在过载风险。",
                "type": "risk",
                "severity": "high",
                "related_entity_ids": [nid] + [p.id for p in connected_items],
                "category": "resource",
                "evidence": f"图谱显示 {e.name} 与 {len(connected_items)} 个事项有高权重关联",
                "suggested_action": "建议评估该人员工作负荷，考虑任务分流或增加项目支援",
            })

    # 模式2：单点依赖 — item 只关联 1 个 person 且被频繁提及
    for nid in G.nodes:
        e = entity_map.get(nid)
        if not e or e.entity_type != "item":
            continue
        connected_people = [
            entity_map[nb] for nb in G.neighbors(nid)
            if nb in entity_map and entity_map[nb].entity_type == "person"
        ]
        if len(connected_people) == 1 and e.mention_count >= 3:
            person = connected_people[0]
            risks.append({
                "title": f"单点依赖：{e.name}",
                "description": f"事项「{e.name}」仅与 {person.name} 一人关联，若该人员不可用，该事项可能受阻。",
                "type": "risk",
                "severity": "medium",
                "related_entity_ids": [nid, person.id],
                "category": "collaboration",
                "evidence": f"{e.name}（提及{e.mention_count}次）仅有 {person.name} 一个关联人员",
                "suggested_action": "建议指定备份负责人或增加跨团队协作",
            })

    # 模式3：信息孤岛 — item 被频繁提及但关联极少
    for nid in G.nodes:
        e = entity_map.get(nid)
        if not e or e.entity_type != "item":
            continue
        if e.mention_count >= 5 and G.degree(nid) <= 1:
            risks.append({
                "title": f"信息孤岛：{e.name}",
                "description": f"事项「{e.name}」被提及 {e.mention_count} 次但关联极少，可能存在信息断层。",
                "type": "risk",
                "severity": "low",
                "related_entity_ids": [nid],
                "category": "collaboration",
                "evidence": f"提及{e.mention_count}次但图谱度数仅{G.degree(nid)}",
                "suggested_action": "建议核实该事项的负责人和相关团队，补充关联信息",
            })

    return risks[:8]


# ═══════════════════════════════════════════════════════════════════
# 5. LLM 洞察生成
# ═══════════════════════════════════════════════════════════════════

async def generate_llm_insights(metrics: dict, communities: list[dict]) -> list[dict]:
    """用 LLM 将算法指标转化为自然语言洞察。"""
    if not settings.agent_llm_api_key:
        logger.warning("agent_llm_api_key 未配置，跳过 LLM 洞察生成")
        return _fallback_insights(metrics)

    client = create_openai_client(
        api_key=settings.agent_llm_api_key,
        base_url=settings.agent_llm_base_url,
        timeout=120.0,
    )

    domain_summary = [
        {"domain": c.get("domain_label", c["label"]), "member_count": c["member_count"], "top_entities": c["top_entities"]}
        for c in communities
    ]

    data_payload = {
        "business_domains": domain_summary,
        "top_connectors": metrics["top_connectors"][:5],
        "top_bridges": metrics["top_bridges"][:5],
        "hot_items": metrics["hot_items"][:5],
    }

    prompt = f"""你是一个企业知识图谱分析专家。根据以下图谱分析数据，生成 3-5 条关键业务洞察。

分析数据：
{json.dumps(data_payload, ensure_ascii=False, indent=2)}

请严格按以下 JSON 格式输出（不要输出其他内容）：
[
  {{
    "title": "简短标题",
    "description": "详细描述（1-2句话）",
    "type": "insight",
    "severity": "high 或 medium 或 low",
    "related_entity_ids": []
  }}
]

要求：
- 关注业务价值和协作模式的正面发现
- 用中文输出
- 描述要具体、可操作"""

    try:
        response = await client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        content = response.choices[0].message.content.strip()
        logger.info("LLM 洞察原始返回 (%d chars): %s", len(content), content[:200])
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        parsed = json.loads(content)
        logger.info("LLM 洞察解析成功: %d 条", len(parsed))
        return parsed
    except json.JSONDecodeError as e:
        logger.error("LLM 洞察 JSON 解析失败: %s, 原始内容: %s", e, content[:500])
        return _fallback_insights(metrics)
    except Exception as e:
        logger.error("LLM 洞察生成失败: %s: %s", type(e).__name__, e, exc_info=True)
        return _fallback_insights(metrics)


def _fallback_insights(metrics: dict) -> list[dict]:
    """LLM 不可用时的降级洞察。"""
    insights = []

    if metrics["top_connectors"]:
        top = metrics["top_connectors"][0]
        insights.append({
            "title": f"核心连接者：{top['name']}",
            "description": f"{top['name']} 在图谱中拥有最高的连接度（{top['score']:.2%}），是组织中的关键枢纽人物。",
            "type": "insight",
            "severity": "medium",
            "related_entity_ids": [top["id"]],
        })

    if metrics["hot_items"]:
        top = metrics["hot_items"][0]
        insights.append({
            "title": f"最活跃事项：{top['name']}",
            "description": f"{top['name']} 的关联权重总和为 {top['weight_sum']}，是当前最受关注的事项。",
            "type": "insight",
            "severity": "low",
            "related_entity_ids": [top["id"]],
        })

    if metrics["top_bridges"]:
        top = metrics["top_bridges"][0]
        insights.append({
            "title": f"跨域桥梁：{top['name']}",
            "description": f"{top['name']} 的中介中心性最高（{top['score']:.2%}），在不同团队/项目之间起到关键桥梁作用。",
            "type": "insight",
            "severity": "medium",
            "related_entity_ids": [top["id"]],
        })

    if metrics.get("isolated") and len(metrics["isolated"]) >= 3:
        count = len(metrics["isolated"])
        insights.append({
            "title": f"发现 {count} 个孤立实体",
            "description": f"图谱中有 {count} 个实体仅有 0-1 个关联，可能存在信息孤岛。考虑补充相关数据或建立关联。",
            "type": "insight",
            "severity": "low",
            "related_entity_ids": [e["id"] for e in metrics["isolated"][:5]],
        })

    if not insights:
        insights.append({
            "title": "图谱概览",
            "description": "知识图谱已构建完成。随着更多数据导入，将自动发现更多有价值的业务洞察。",
            "type": "insight",
            "severity": "low",
            "related_entity_ids": [],
        })

    return insights


# ═══════════════════════════════════════════════════════════════════
# 6. 低质量实体修剪（聚焦高频人物 + 相关事件）
# ═══════════════════════════════════════════════════════════════════

async def _prune_low_quality_entities(db: AsyncSession, owner_id: str) -> int:
    """修剪低质量实体：保留高频人物和与其关联的事项，删除碎片信息。

    策略：
    1. 核心人物 = mention_count >= 2 的 person
    2. item 必须与至少一个核心人物有关系，否则删除
    3. 删除 mention_count == 1 且无任何关系的孤立实体
    """
    # 加载所有实体
    all_entities_result = await db.execute(
        select(KGEntity).where(KGEntity.owner_id == owner_id)
    )
    all_entities = all_entities_result.scalars().all()
    if not all_entities:
        return 0

    entity_map = {e.id: e for e in all_entities}

    # 核心人物：mention_count >= 2 的 person
    core_person_ids = {
        e.id for e in all_entities
        if e.entity_type == "person" and e.mention_count >= 2
    }

    # 加载所有关系
    all_relations_result = await db.execute(
        select(KGRelation).where(KGRelation.owner_id == owner_id)
    )
    all_relations = all_relations_result.scalars().all()

    # 构建邻接表
    neighbors: dict[int, set[int]] = defaultdict(set)
    for r in all_relations:
        neighbors[r.source_entity_id].add(r.target_entity_id)
        neighbors[r.target_entity_id].add(r.source_entity_id)

    # 决定要删除的实体
    to_delete: set[int] = set()
    for e in all_entities:
        if e.id in core_person_ids:
            continue  # 核心人物保留

        if e.entity_type == "person" and e.mention_count >= 2:
            continue  # 高频人物保留

        if e.entity_type == "item":
            # item 必须与至少一个核心人物有关系
            connected_to_core = bool(neighbors.get(e.id, set()) & core_person_ids)
            if not connected_to_core:
                to_delete.add(e.id)
                continue

        # 孤立且低频实体删除
        if e.mention_count <= 1 and len(neighbors.get(e.id, set())) == 0:
            to_delete.add(e.id)

    if not to_delete:
        return 0

    # 先删关系再删实体
    from app.models.content_entity_link import ContentEntityLink
    await db.execute(
        delete(KGRelation).where(
            and_(
                KGRelation.owner_id == owner_id,
                or_(
                    KGRelation.source_entity_id.in_(to_delete),
                    KGRelation.target_entity_id.in_(to_delete),
                ),
            )
        )
    )
    await db.execute(
        delete(ContentEntityLink).where(ContentEntityLink.entity_id.in_(to_delete))
    )
    await db.execute(
        delete(KGEntity).where(
            and_(KGEntity.owner_id == owner_id, KGEntity.id.in_(to_delete))
        )
    )
    await db.commit()

    logger.info("修剪低质量实体: 删除 %d / %d 个实体 (owner=%s)", len(to_delete), len(all_entities), owner_id)
    return len(to_delete)


# ═══════════════════════════════════════════════════════════════════
# 7. 完整分析流程
# ═══════════════════════════════════════════════════════════════════

async def run_full_analysis(db: AsyncSession, owner_id: str, profile=None) -> dict:
    """运行完整分析：修剪 → 社群检测+域标签 → 重要性评分 → 业务风险 → LLM洞察。"""
    # 0. 修剪低质量实体（聚焦高频人物和相关事件）
    pruned = await _prune_low_quality_entities(db, owner_id)
    if pruned:
        logger.info("已修剪 %d 个低质量实体，重新加载图谱", pruned)

    entities, relations, G = await _load_graph(db, owner_id)

    if len(entities) == 0:
        return {"communities": [], "insights": [], "risks": []}

    # 1. 社群检测 + 业务域标签
    communities = await detect_communities(db, owner_id, entities, relations, G, profile=profile)

    # 2. 指标计算
    metrics = compute_metrics(G, entities)

    # 3. 重要性评分（写回 DB）
    await compute_importance_scores(db, owner_id, entities, G)

    # 4. 业务风险提取（基于内容语义）
    risks = await extract_business_risks(db, owner_id, entities, G)

    # 5. LLM 洞察
    insights = await generate_llm_insights(metrics, communities)
    insights = [i for i in insights if i.get("type", "insight") != "risk"]

    # 格式化社群信息
    communities_out = [
        {
            "community_id": c["community_id"],
            "member_count": c["member_count"],
            "top_entities": c["top_entities"],
            "label": c["label"],
            "domain_label": c.get("domain_label", ""),
        }
        for c in communities
    ]

    return {
        "communities": communities_out,
        "insights": insights,
        "risks": risks,
    }
