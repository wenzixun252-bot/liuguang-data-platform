"""知识图谱分析服务 — 业务域识别、重要性评分、业务风险提取、LLM 总结。"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta

import networkx as nx
from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.llm import create_openai_client
from app.models.content_entity_link import ContentEntityLink
from app.models.knowledge_graph import KGEntity, KGRelation

logger = logging.getLogger(__name__)

MAX_ANALYSIS_NODES = 500

# ── 类型权重映射 ──
_TYPE_WEIGHTS = {
    "person": 1.0,
    "project": 1.0,
    "event": 0.8,
    "organization": 0.7,
    "topic": 0.6,
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

async def detect_communities(db: AsyncSession, owner_id: str, entities: list = None, relations: list = None, G: nx.Graph = None) -> list[dict]:
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

        # 收集社群内实体的内容片段
        community_snippets = []
        top_member_ids = [m.id for m in top_members[:5]]
        if top_member_ids:
            snippet_result = await db.execute(
                select(ContentEntityLink.context_snippet, ContentEntityLink.entity_id)
                .where(ContentEntityLink.entity_id.in_(top_member_ids))
                .order_by(ContentEntityLink.id.desc())
                .limit(10)
            )
            for row in snippet_result.all():
                if row.context_snippet:
                    community_snippets.append(row.context_snippet[:100])

        # 统计实体类型分布
        type_counts = defaultdict(int)
        for m in members:
            type_counts[m.entity_type] += 1

        result.append({
            "community_id": idx,
            "member_count": len(member_ids),
            "top_entities": top_names,
            "label": label,
            "domain_label": "",
            "member_ids": list(member_ids),
            "_top_members_detail": [
                {"name": m.name, "type": m.entity_type} for m in top_members
            ],
            "_relations_summary": community_relations[:15],
            "_content_snippets": community_snippets[:6],
            "_type_distribution": dict(type_counts),
        })

    await db.commit()

    # LLM 业务域命名
    result = await _label_domains_via_llm(result)
    return result


async def _label_domains_via_llm(communities: list[dict]) -> list[dict]:
    """用 LLM 为每个社群分配业务域名称。"""
    if not settings.agent_llm_api_key or not communities:
        # 降级：使用实体类型推断
        for c in communities:
            c["domain_label"] = c["label"]
        return communities

    client = create_openai_client(
        api_key=settings.agent_llm_api_key,
        base_url=settings.agent_llm_base_url,
        timeout=120.0,
    )

    # 只对成员数 >= 3 的社群调用 LLM 命名
    big_communities = [c for c in communities if c["member_count"] >= 3]
    if not big_communities:
        for c in communities:
            c["domain_label"] = c["label"]
        return communities

    payload = []
    for c in big_communities:
        payload.append({
            "community_id": c["community_id"],
            "member_count": c["member_count"],
            "type_distribution": c.get("_type_distribution", {}),
            "members": c.get("_top_members_detail", []),
            "key_relations": c.get("_relations_summary", [])[:8],
            "content_snippets": c.get("_content_snippets", [])[:4],
        })

    prompt = f"""你是企业数据分析专家。以下是从企业知识图谱中用社群检测算法分出的实体群组。
请根据群组内的实体关系和内容片段，判断每个群组对应的企业职能业务域。

## 业务域必须是企业职能领域，例如：
财务管理、投资并购、风险合规、市场营销、产品研发、技术架构、人力资源、客户管理、项目管理、战略规划、运营管理、法务合规、供应链、数据分析、行政后勤

## 判断依据优先级：
1. 关系中的动作语义（works_on/discusses 的对象是什么业务）
2. 内容片段中的业务关键词（融资、审批、开发、招聘等）
3. 涉及的组织和项目名称所暗示的职能领域
4. 实体类型分布（多 organization = 可能是商务/合作）

## 要求：
- 名称必须是 2-4 个中文字的职能领域名称
- 绝对不要用人名、项目名、公司名拼凑
- 不同群组尽量分配不同的业务域，避免重复
- 如果群组确实跨多个职能且无法归类，用"综合事务"

群组数据：
{json.dumps(payload, ensure_ascii=False, indent=2)}

严格按JSON格式输出，不要输出其他内容：
[{{"community_id": 0, "domain_label": "业务域名称"}}]"""

    try:
        response = await client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=500,
        )
        content = response.choices[0].message.content.strip()
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        labels = json.loads(content)
        label_map = {item["community_id"]: item["domain_label"] for item in labels}
        for c in communities:
            c["domain_label"] = label_map.get(c["community_id"], c["label"])
    except Exception as e:
        logger.error(f"LLM 业务域命名失败: {e}")
        for c in communities:
            c["domain_label"] = c["label"]

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
        return {"top_connectors": [], "top_bridges": [], "hot_projects": [], "isolated": []}

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

    hot_projects = []
    for nid in G.nodes:
        e = entity_map.get(nid)
        if e and e.entity_type == "project":
            total_weight = sum(d.get("weight", 1) for _, _, d in G.edges(nid, data=True))
            hot_projects.append({"id": nid, "name": e.name, "weight_sum": total_weight})
    hot_projects.sort(key=lambda x: x["weight_sum"], reverse=True)
    hot_projects = hot_projects[:10]

    isolated = [
        {"id": nid, "name": entity_map[nid].name, "type": entity_map[nid].entity_type}
        for nid in G.nodes if G.degree(nid) <= 1 and nid in entity_map
    ]

    return {
        "top_connectors": top_connectors,
        "top_bridges": top_bridges,
        "hot_projects": hot_projects,
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
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        risks = json.loads(content)

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
    except Exception as e:
        logger.error(f"LLM 业务风险提取失败: {e}")
        return _detect_structural_risks(G, entities)


def _detect_structural_risks(G: nx.Graph, entities: list) -> list[dict]:
    """降级方案：基于图结构检测风险（当 LLM 不可用时）。"""
    entity_map = {e.id: e for e in entities}
    risks = []

    # 单点依赖：person 连接 >= 3 个 project 且权重高
    for nid in G.nodes:
        e = entity_map.get(nid)
        if not e or e.entity_type != "person":
            continue
        connected_projects = []
        for neighbor in G.neighbors(nid):
            ne = entity_map.get(neighbor)
            if ne and ne.entity_type == "project":
                w = G[nid][neighbor].get("weight", 1)
                if w >= 2:
                    connected_projects.append(ne)
        if len(connected_projects) >= 3:
            proj_names = ", ".join(p.name for p in connected_projects[:5])
            risks.append({
                "title": f"资源过载风险：{e.name}",
                "description": f"{e.name} 同时深度参与 {len(connected_projects)} 个项目（{proj_names}），存在过载风险。",
                "type": "risk",
                "severity": "high",
                "related_entity_ids": [nid] + [p.id for p in connected_projects],
                "category": "resource",
                "evidence": f"图谱显示 {e.name} 与 {len(connected_projects)} 个项目有高权重关联",
                "suggested_action": "建议评估该人员工作负荷，考虑任务分流或增加项目支援",
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
        "hot_projects": metrics["hot_projects"][:5],
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
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        return json.loads(content)
    except Exception as e:
        logger.error(f"LLM 洞察生成失败: {e}")
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

    if metrics["hot_projects"]:
        top = metrics["hot_projects"][0]
        insights.append({
            "title": f"最活跃项目：{top['name']}",
            "description": f"{top['name']} 的关联权重总和为 {top['weight_sum']}，是当前最活跃的项目。",
            "type": "insight",
            "severity": "low",
            "related_entity_ids": [top["id"]],
        })

    return insights


# ═══════════════════════════════════════════════════════════════════
# 6. 完整分析流程
# ═══════════════════════════════════════════════════════════════════

async def run_full_analysis(db: AsyncSession, owner_id: str) -> dict:
    """运行完整分析：社群检测+域标签 → 重要性评分 → 业务风险 → LLM洞察。"""
    entities, relations, G = await _load_graph(db, owner_id)

    if len(entities) == 0:
        return {"communities": [], "insights": [], "risks": []}

    # 1. 社群检测 + 业务域标签
    communities = await detect_communities(db, owner_id, entities, relations, G)

    # 2. 指标计算
    metrics = compute_metrics(G, entities)

    # 3. 重要性评分（写回 DB）
    await compute_importance_scores(db, owner_id, entities, G)

    # 4. 业务风险提取（基于内容语义）
    risks = await extract_business_risks(db, owner_id, entities, G)

    # 5. LLM 洞察
    insights = await generate_llm_insights(metrics, communities)
    insights = [i for i in insights if i.get("type") == "insight"]

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
