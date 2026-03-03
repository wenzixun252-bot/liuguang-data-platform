"""知识图谱分析服务 — 社群检测、指标计算、风险检测、LLM 总结。"""

import json
import logging
from collections import defaultdict

import networkx as nx
from openai import AsyncOpenAI
from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.knowledge_graph import KGEntity, KGRelation

logger = logging.getLogger(__name__)

MAX_ANALYSIS_NODES = 500


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


async def detect_communities(db: AsyncSession, owner_id: str) -> list[dict]:
    """运行 Louvain 社群检测，将 community_id 写回数据库，返回社群列表。"""
    entities, relations, G = await _load_graph(db, owner_id)

    if len(G.nodes) < 2:
        return []

    communities_iter = nx.algorithms.community.louvain_communities(G, weight="weight", seed=42)
    communities = list(communities_iter)

    result = []
    for idx, member_ids in enumerate(communities):
        # 将 community_id 写入数据库
        await db.execute(
            update(KGEntity)
            .where(and_(KGEntity.owner_id == owner_id, KGEntity.id.in_(member_ids)))
            .values(community_id=idx)
        )

        # 构建社群信息
        members = [e for e in entities if e.id in member_ids]
        members.sort(key=lambda e: e.mention_count, reverse=True)
        top_names = [m.name for m in members[:3]]
        label = " · ".join(top_names)

        result.append({
            "community_id": idx,
            "member_count": len(member_ids),
            "top_entities": top_names,
            "label": label,
            "member_ids": list(member_ids),
        })

    await db.commit()
    return result


def compute_metrics(G: nx.Graph, entities: list) -> dict:
    """计算图谱核心指标。"""
    if len(G.nodes) < 2:
        return {"top_connectors": [], "top_bridges": [], "hot_projects": [], "isolated": []}

    degree = nx.degree_centrality(G)
    betweenness = nx.betweenness_centrality(G, weight="weight")

    entity_map = {e.id: e for e in entities}

    # 度中心性 top 10
    top_connectors = sorted(degree.items(), key=lambda x: x[1], reverse=True)[:10]
    top_connectors = [
        {"id": nid, "name": entity_map[nid].name, "type": entity_map[nid].entity_type, "score": round(score, 4)}
        for nid, score in top_connectors if nid in entity_map
    ]

    # 介数中心性 top 10
    top_bridges = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)[:10]
    top_bridges = [
        {"id": nid, "name": entity_map[nid].name, "type": entity_map[nid].entity_type, "score": round(score, 4)}
        for nid, score in top_bridges if nid in entity_map
    ]

    # 项目热度（按边权重总和排序 project 类型实体）
    hot_projects = []
    for nid in G.nodes:
        e = entity_map.get(nid)
        if e and e.entity_type == "project":
            total_weight = sum(d.get("weight", 1) for _, _, d in G.edges(nid, data=True))
            hot_projects.append({"id": nid, "name": e.name, "weight_sum": total_weight})
    hot_projects.sort(key=lambda x: x["weight_sum"], reverse=True)
    hot_projects = hot_projects[:10]

    # 孤立节点（度数 <= 1）
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


def detect_risks(G: nx.Graph, entities: list, communities: list[dict]) -> list[dict]:
    """基于纯算法规则检测风险。"""
    entity_map = {e.id: e for e in entities}
    risks = []

    # 1. 单点依赖：person 连接 >= 3 个 project 且权重高
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
                "type": "single_point_dependency",
                "title": f"单点依赖风险：{e.name}",
                "description": f"{e.name} 同时深度参与 {len(connected_projects)} 个项目（{proj_names}），若该人员离开将影响多个项目。",
                "severity": "high",
                "related_entity_ids": [nid] + [p.id for p in connected_projects],
            })

    # 2. 孤立节点
    isolated_nodes = [nid for nid in G.nodes if G.degree(nid) <= 1]
    if isolated_nodes:
        names = ", ".join(entity_map[nid].name for nid in isolated_nodes[:5] if nid in entity_map)
        suffix = f"等 {len(isolated_nodes)} 个" if len(isolated_nodes) > 5 else ""
        risks.append({
            "type": "isolated_nodes",
            "title": f"孤立节点：{len(isolated_nodes)} 个实体缺乏连接",
            "description": f"以下实体几乎没有关联：{names}{suffix}。建议检查数据完整性或建立更多关联。",
            "severity": "low",
            "related_entity_ids": isolated_nodes[:20],
        })

    # 3. 社群断裂：检查社群之间是否有连接
    if len(communities) >= 2:
        comm_member_map = {}
        for c in communities:
            for mid in c["member_ids"]:
                comm_member_map[mid] = c["community_id"]

        cross_edges = defaultdict(int)
        for u, v in G.edges():
            cu = comm_member_map.get(u)
            cv = comm_member_map.get(v)
            if cu is not None and cv is not None and cu != cv:
                pair = (min(cu, cv), max(cu, cv))
                cross_edges[pair] += 1

        # 检查哪些社群对之间没有连接
        for i in range(len(communities)):
            for j in range(i + 1, len(communities)):
                pair = (i, j)
                if cross_edges.get(pair, 0) == 0:
                    ci = communities[i]
                    cj = communities[j]
                    risks.append({
                        "type": "community_disconnect",
                        "title": f"社群断裂：「{ci['label']}」与「{cj['label']}」",
                        "description": f"社群 {ci['community_id']}（{ci['member_count']}人）和社群 {cj['community_id']}（{cj['member_count']}人）之间没有任何连接，可能存在信息孤岛。",
                        "severity": "medium",
                        "related_entity_ids": (ci["member_ids"][:3] + cj["member_ids"][:3]),
                    })

    return risks


async def generate_llm_insights(metrics: dict, risks: list[dict]) -> list[dict]:
    """用 LLM 将算法指标转化为自然语言洞察。"""
    if not settings.agent_llm_api_key:
        logger.warning("agent_llm_api_key 未配置，跳过 LLM 洞察生成")
        return _fallback_insights(metrics, risks)

    client = AsyncOpenAI(
        api_key=settings.agent_llm_api_key,
        base_url=settings.agent_llm_base_url,
    )

    data_payload = {
        "top_connectors": metrics["top_connectors"][:5],
        "top_bridges": metrics["top_bridges"][:5],
        "hot_projects": metrics["hot_projects"][:5],
        "isolated_count": len(metrics["isolated"]),
        "risks": [{"type": r["type"], "title": r["title"], "severity": r["severity"]} for r in risks],
    }

    prompt = f"""你是一个企业知识图谱分析专家。根据以下图谱指标数据，生成 3-6 条关键洞察和建议。

指标数据：
{json.dumps(data_payload, ensure_ascii=False, indent=2)}

请严格按以下 JSON 格式输出（不要输出其他内容）：
[
  {{
    "title": "简短标题",
    "description": "详细描述（1-2句话）",
    "type": "insight 或 risk",
    "severity": "high 或 medium 或 low",
    "related_entity_ids": []
  }}
]

要求：
- insight 类型关注正面发现和建议，risk 类型关注潜在问题
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
        # 尝试从 markdown 代码块中提取 JSON
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        return json.loads(content)
    except Exception as e:
        logger.error(f"LLM 洞察生成失败: {e}")
        return _fallback_insights(metrics, risks)


def _fallback_insights(metrics: dict, risks: list[dict]) -> list[dict]:
    """LLM 不可用时的降级：基于算法指标生成基础洞察。"""
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

    if metrics["top_bridges"]:
        top = metrics["top_bridges"][0]
        insights.append({
            "title": f"关键桥梁：{top['name']}",
            "description": f"{top['name']} 具有最高的介数中心性（{top['score']:.2%}），是连接不同群体的关键桥梁。",
            "type": "insight",
            "severity": "medium",
            "related_entity_ids": [top["id"]],
        })

    if metrics["hot_projects"]:
        top = metrics["hot_projects"][0]
        insights.append({
            "title": f"最热门项目：{top['name']}",
            "description": f"{top['name']} 的关联权重总和为 {top['weight_sum']}，是当前最活跃的项目。",
            "type": "insight",
            "severity": "low",
            "related_entity_ids": [top["id"]],
        })

    if metrics["isolated"]:
        insights.append({
            "title": f"{len(metrics['isolated'])} 个孤立实体",
            "description": "这些实体缺乏足够的关联关系，建议检查数据源或补充关联信息。",
            "type": "risk",
            "severity": "low",
            "related_entity_ids": [n["id"] for n in metrics["isolated"][:10]],
        })

    return insights


async def run_full_analysis(db: AsyncSession, owner_id: str) -> dict:
    """运行完整分析流程：社群检测 + 指标计算 + 风险检测 + LLM 总结。"""
    entities, relations, G = await _load_graph(db, owner_id)

    if len(entities) == 0:
        return {"communities": [], "insights": [], "risks": []}

    # 1. 社群检测
    communities = await detect_communities(db, owner_id)

    # 2. 指标计算
    metrics = compute_metrics(G, entities)

    # 3. 风险检测
    risks = detect_risks(G, entities, communities)

    # 4. LLM 总结
    llm_insights = await generate_llm_insights(metrics, risks)

    # 拆分 insights 和 risks
    insights_list = [i for i in llm_insights if i.get("type") == "insight"]
    risks_from_llm = [i for i in llm_insights if i.get("type") == "risk"]

    # 合并算法风险和 LLM 风险
    all_risks = [
        {
            "title": r["title"],
            "description": r["description"],
            "type": "risk",
            "severity": r["severity"],
            "related_entity_ids": r["related_entity_ids"],
        }
        for r in risks
    ] + risks_from_llm

    # 格式化社群信息（去掉 member_ids 内部字段）
    communities_out = [
        {
            "community_id": c["community_id"],
            "member_count": c["member_count"],
            "top_entities": c["top_entities"],
            "label": c["label"],
        }
        for c in communities
    ]

    return {
        "communities": communities_out,
        "insights": insights_list,
        "risks": all_risks,
    }
