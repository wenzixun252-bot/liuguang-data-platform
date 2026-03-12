"""RAG 检索引擎 — 权限感知的跨两表混合检索 (Vector + BM25 + RRF)。"""

import logging
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.llm import llm_client

logger = logging.getLogger(__name__)


@dataclass
class MatchedTag:
    """匹配到的标签。"""
    id: int
    name: str
    category: str


@dataclass
class SearchResult:
    """单条检索结果。"""

    id: int
    source_table: str  # 'document' | 'communication'
    title: str | None
    content_text: str
    owner_id: str
    score: float = 0.0
    feishu_record_id: str | None = None  # 用于跨用户去重
    import_count: int = 1               # 同一飞书文档被多少人归档（社群热度）
    matched_tags: list[str] = field(default_factory=list)  # 命中的标签名称列表
    key_info: dict | None = None        # 提取规则产出的关键信息


# 所有可搜索的表
ALL_SOURCE_TABLES = ["document", "communication"]

# 表名到实际数据库表名的映射
_TABLE_MAP = {
    "document": "documents",
    "communication": "communications",
}


def _build_owner_filter(visible_ids: list[str] | None) -> tuple[str, dict]:
    """构建 owner_id 过滤子句。"""
    if visible_ids is None:
        return "TRUE", {}
    placeholders = ", ".join(f":vid_{i}" for i in range(len(visible_ids)))
    params = {f"vid_{i}": vid for i, vid in enumerate(visible_ids)}
    return f"owner_id IN ({placeholders})", params


def _build_tag_filter(
    source_table: str,
    tag_ids: list[int] | None,
) -> tuple[str, dict]:
    """构建标签过滤子句。"""
    if not tag_ids:
        return "TRUE", {}
    placeholders = ", ".join(f":tagid_{i}" for i in range(len(tag_ids)))
    params = {f"tagid_{i}": tid for i, tid in enumerate(tag_ids)}
    return (
        f"id IN (SELECT content_id FROM content_tags "
        f"WHERE content_type = '{source_table}' AND tag_id IN ({placeholders}))"
    ), params


def _build_id_filter(
    source_table: str,
    source_ids: list[tuple[str, int]] | None,
) -> tuple[str, dict]:
    """构建 id IN (...) 过滤子句（按具体记录过滤）。"""
    if source_ids is None:
        return "TRUE", {}
    ids_for_table = [sid for st, sid in source_ids if st == source_table]
    if not ids_for_table:
        return "FALSE", {}
    placeholders = ", ".join(f":sid_{source_table}_{i}" for i in range(len(ids_for_table)))
    params = {f"sid_{source_table}_{i}": sid for i, sid in enumerate(ids_for_table)}
    return f"id IN ({placeholders})", params


def _build_time_filter(
    source_table: str,
    time_start: datetime | None,
    time_end: datetime | None,
) -> tuple[str, dict]:
    """构建智能时间过滤子句。

    - documents 表（cloud）：COALESCE(feishu_created_at, feishu_updated_at, created_at)
    - documents 表（local）：created_at
    - communications 表：COALESCE(comm_time, created_at)
    """
    if time_start is None and time_end is None:
        return "TRUE", {}

    if source_table == "document":
        eff = "CASE WHEN source_type = 'cloud' THEN COALESCE(feishu_created_at, feishu_updated_at, created_at) ELSE created_at END"
    else:
        eff = "COALESCE(comm_time, created_at)"

    clauses = []
    params: dict = {}
    if time_start is not None:
        clauses.append(f"{eff} >= :time_start")
        params["time_start"] = time_start.replace(tzinfo=None) if time_start.tzinfo else time_start
    if time_end is not None:
        clauses.append(f"{eff} <= :time_end")
        params["time_end"] = time_end.replace(tzinfo=None) if time_end.tzinfo else time_end

    return " AND ".join(clauses), params


def _get_tables_to_search(
    source_tables: list[str] | None,
    source_ids: list[tuple[str, int]] | None,
) -> list[str]:
    """确定需要搜索哪些表。"""
    if source_ids is not None:
        return list({st for st, _ in source_ids})
    if source_tables is not None:
        return [t for t in source_tables if t in ALL_SOURCE_TABLES]
    return ALL_SOURCE_TABLES


# ── 向量检索 ─────────────────────────────────────────────


class VectorSearcher:
    """权限感知的跨三表向量检索。"""

    async def search(
        self,
        query_text: str,
        visible_ids: list[str] | None,
        db: AsyncSession,
        top_k: int = 10,
        source_tables: list[str] | None = None,
        source_ids: list[tuple[str, int]] | None = None,
        tag_ids: list[int] | None = None,
        time_start: datetime | None = None,
        time_end: datetime | None = None,
    ) -> list[SearchResult]:
        query_embedding = await llm_client.generate_embedding(query_text)
        vector_str = f"[{','.join(str(v) for v in query_embedding)}]"

        owner_filter, owner_params = _build_owner_filter(visible_ids)
        tables = _get_tables_to_search(source_tables, source_ids)

        unions = []
        all_params: dict = {"query_vector": vector_str, "top_k": top_k, **owner_params}

        for table_key in tables:
            db_table = _TABLE_MAP[table_key]
            id_filter, id_params = _build_id_filter(table_key, source_ids)
            tag_filter, tag_params = _build_tag_filter(table_key, tag_ids)
            time_filter, time_params = _build_time_filter(table_key, time_start, time_end)
            all_params.update(id_params)
            all_params.update(tag_params)
            all_params.update(time_params)

            unions.append(
                f"SELECT id, '{table_key}' as source_table, title, content_text, owner_id, "
                f"feishu_record_id, key_info, "
                f"content_vector <=> :query_vector AS distance "
                f"FROM {db_table} "
                f"WHERE content_vector IS NOT NULL AND {owner_filter} AND {id_filter} AND {tag_filter} AND {time_filter}"
            )

        if not unions:
            return []

        sql = text(
            f"SELECT id, source_table, title, content_text, owner_id, feishu_record_id, key_info, distance FROM ("
            f"{' UNION ALL '.join(unions)}"
            f") combined ORDER BY distance ASC LIMIT :top_k"
        )

        result = await db.execute(sql, all_params)
        rows = result.fetchall()

        return [
            SearchResult(
                id=row.id,
                source_table=row.source_table,
                title=row.title,
                content_text=row.content_text,
                owner_id=row.owner_id,
                score=1.0 / (1.0 + row.distance),
                feishu_record_id=row.feishu_record_id,
                key_info=row.key_info,
            )
            for row in rows
        ]


# ── BM25 关键词检索 ──────────────────────────────────────


class BM25Searcher:
    """权限感知的跨两表全文关键词检索。"""

    async def search(
        self,
        query_text: str,
        visible_ids: list[str] | None,
        db: AsyncSession,
        top_k: int = 10,
        source_tables: list[str] | None = None,
        source_ids: list[tuple[str, int]] | None = None,
        tag_ids: list[int] | None = None,
        time_start: datetime | None = None,
        time_end: datetime | None = None,
    ) -> list[SearchResult]:
        owner_filter, owner_params = _build_owner_filter(visible_ids)
        tables = _get_tables_to_search(source_tables, source_ids)

        unions = []
        all_params: dict = {"query": query_text, "top_k": top_k, **owner_params}

        for table_key in tables:
            db_table = _TABLE_MAP[table_key]
            id_filter, id_params = _build_id_filter(table_key, source_ids)
            tag_filter, tag_params = _build_tag_filter(table_key, tag_ids)
            time_filter, time_params = _build_time_filter(table_key, time_start, time_end)
            all_params.update(id_params)
            all_params.update(tag_params)
            all_params.update(time_params)

            ts_content = "coalesce(title, '') || ' ' || content_text || ' ' || coalesce(key_info::text, '')"
            unions.append(
                f"SELECT id, '{table_key}' as source_table, title, content_text, owner_id, "
                f"feishu_record_id, key_info, "
                f"ts_rank_cd(to_tsvector('simple', {ts_content}), plainto_tsquery('simple', :query)) AS rank "
                f"FROM {db_table} "
                f"WHERE to_tsvector('simple', {ts_content}) @@ plainto_tsquery('simple', :query) "
                f"AND {owner_filter} AND {id_filter} AND {tag_filter} AND {time_filter}"
            )

        if not unions:
            return []

        sql = text(
            f"SELECT id, source_table, title, content_text, owner_id, feishu_record_id, key_info, rank FROM ("
            f"{' UNION ALL '.join(unions)}"
            f") combined ORDER BY rank DESC LIMIT :top_k"
        )

        result = await db.execute(sql, all_params)
        rows = result.fetchall()

        return [
            SearchResult(
                id=row.id,
                source_table=row.source_table,
                title=row.title,
                content_text=row.content_text,
                owner_id=row.owner_id,
                score=float(row.rank),
                feishu_record_id=row.feishu_record_id,
                key_info=row.key_info,
            )
            for row in rows
        ]


# ── 混合检索融合 (RRF) ──────────────────────────────────


class HybridSearcher:
    """混合检索：向量 + BM25，使用 Reciprocal Rank Fusion (RRF) 合并排序。"""

    def __init__(self, k: int = 60) -> None:
        self.vector_searcher = VectorSearcher()
        self.bm25_searcher = BM25Searcher()
        self.k = k

    async def search(
        self,
        query_text: str,
        visible_ids: list[str] | None,
        db: AsyncSession,
        top_k: int = 5,
        source_tables: list[str] | None = None,
        source_ids: list[tuple[str, int]] | None = None,
        tag_ids: list[int] | None = None,
        boost_tag_ids: list[int] | None = None,
        time_start: datetime | None = None,
        time_end: datetime | None = None,
    ) -> list[SearchResult]:
        vector_results = await self.vector_searcher.search(
            query_text, visible_ids, db, top_k=top_k * 2,
            source_tables=source_tables, source_ids=source_ids, tag_ids=tag_ids,
            time_start=time_start, time_end=time_end,
        )
        bm25_results = await self.bm25_searcher.search(
            query_text, visible_ids, db, top_k=top_k * 2,
            source_tables=source_tables, source_ids=source_ids, tag_ids=tag_ids,
            time_start=time_start, time_end=time_end,
        )

        # RRF 融合，key 为 (source_table, id) 元组
        rrf_scores: dict[tuple, float] = {}
        result_map: dict[tuple, SearchResult] = {}

        for rank, r in enumerate(vector_results):
            key = (r.source_table, r.id)
            rrf_scores[key] = rrf_scores.get(key, 0) + 1.0 / (self.k + rank + 1)
            result_map[key] = r

        for rank, r in enumerate(bm25_results):
            key = (r.source_table, r.id)
            rrf_scores[key] = rrf_scores.get(key, 0) + 1.0 / (self.k + rank + 1)
            if key not in result_map:
                result_map[key] = r

        # 先赋予基础 RRF 分数
        for key, score in rrf_scores.items():
            result_map[key].score = score

        # 查询所有文档类结果的归档人数，用于社群热度加权
        doc_frids = list({
            r.feishu_record_id
            for r in result_map.values()
            if r.source_table == "document" and r.feishu_record_id
        })
        import_count_map: dict[str, int] = {}
        if doc_frids:
            from sqlalchemy import func as sa_func
            from app.models.document import Document as DocModel
            placeholders = ", ".join(f":frid_{i}" for i in range(len(doc_frids)))
            frid_params = {f"frid_{i}": frid for i, frid in enumerate(doc_frids)}
            count_sql = text(
                f"SELECT feishu_record_id, COUNT(DISTINCT owner_id) AS cnt "
                f"FROM documents WHERE feishu_record_id IN ({placeholders}) "
                f"GROUP BY feishu_record_id"
            )
            count_rows = (await db.execute(count_sql, frid_params)).fetchall()
            import_count_map = {row.feishu_record_id: row.cnt for row in count_rows}

        # 应用社群热度加权：score × (1 + 0.15 × log₂(import_count))
        import math
        for key, r in result_map.items():
            if r.feishu_record_id and r.feishu_record_id in import_count_map:
                cnt = import_count_map[r.feishu_record_id]
                r.import_count = cnt
                if cnt > 1:
                    boost = 1.0 + 0.15 * math.log2(cnt)
                    r.score = rrf_scores[key] * boost

        # ── 标签权重加成 ──
        # 如果用户查询命中了标签，拥有这些标签的内容获得额外加权
        if boost_tag_ids:
            tag_boost_map = await self._query_tag_boost(db, result_map, boost_tag_ids)
            for key, (tag_count, tag_names) in tag_boost_map.items():
                # 每命中一个标签加 30% 权重，多标签叠加
                boost = 1.0 + 0.3 * tag_count
                result_map[key].score *= boost
                result_map[key].matched_tags = tag_names
            logger.info(
                "标签加权: %d/%d 条结果命中标签 (boost_tag_ids=%s)",
                len(tag_boost_map), len(result_map), boost_tag_ids,
            )

        # 重新按加权后分数排序
        sorted_keys = sorted(result_map.keys(), key=lambda k: result_map[k].score, reverse=True)

        # 按 feishu_record_id 去重：同一飞书文档被多个用户导入时只保留排名最高的一条
        results = []
        seen_feishu_ids: set[str] = set()
        for key in sorted_keys:
            r = result_map[key]
            if r.feishu_record_id:
                if r.feishu_record_id in seen_feishu_ids:
                    continue
                seen_feishu_ids.add(r.feishu_record_id)
            results.append(r)
            if len(results) >= top_k:
                break

        logger.info(
            "混合检索完成: vector=%d, bm25=%d, merged=%d (去重+热度+标签加权后)",
            len(vector_results),
            len(bm25_results),
            len(results),
        )
        return results

    async def _query_tag_boost(
        self,
        db: AsyncSession,
        result_map: dict[tuple, SearchResult],
        boost_tag_ids: list[int],
    ) -> dict[tuple, tuple[int, list[str]]]:
        """查询哪些结果拥有指定标签，返回 {(source_table, id): (命中标签数, [标签名])}。"""
        if not result_map or not boost_tag_ids:
            return {}

        # 按 source_table 分组构建查询
        groups: dict[str, list[int]] = {}
        for (source_table, rid) in result_map.keys():
            groups.setdefault(source_table, []).append(rid)

        tag_placeholders = ", ".join(f":btid_{i}" for i in range(len(boost_tag_ids)))
        tag_params = {f"btid_{i}": tid for i, tid in enumerate(boost_tag_ids)}

        boost_map: dict[tuple, tuple[int, list[str]]] = {}

        for source_table, ids in groups.items():
            id_placeholders = ", ".join(f":rid_{source_table}_{i}" for i in range(len(ids)))
            id_params = {f"rid_{source_table}_{i}": rid for i, rid in enumerate(ids)}

            sql = text(
                f"SELECT ct.content_id, COUNT(ct.tag_id) AS tag_count, "
                f"ARRAY_AGG(td.name) AS tag_names "
                f"FROM content_tags ct "
                f"JOIN tag_definitions td ON td.id = ct.tag_id "
                f"WHERE ct.content_type = :content_type "
                f"AND ct.content_id IN ({id_placeholders}) "
                f"AND ct.tag_id IN ({tag_placeholders}) "
                f"GROUP BY ct.content_id"
            )
            params = {"content_type": source_table, **id_params, **tag_params}
            rows = (await db.execute(sql, params)).fetchall()
            for row in rows:
                key = (source_table, row.content_id)
                boost_map[key] = (row.tag_count, list(row.tag_names))

        return boost_map


def format_key_info(key_info: dict | None) -> str:
    """将 key_info dict 格式化为上下文追加文本。

    跳过值为 None 或空字符串的字段。
    返回空字符串表示无有效内容。
    """
    if not key_info or not isinstance(key_info, dict):
        return ""
    parts = []
    for k, v in key_info.items():
        if v is None or v == "":
            continue
        parts.append(f"{k}: {v}")
    if not parts:
        return ""
    return "\n[关键信息] " + " | ".join(parts)


# 模块级单例
hybrid_searcher = HybridSearcher()


# ── 标签匹配工具 ────────────────────────────────────────


async def match_tags_from_query(
    query: str,
    owner_id: str,
    db: AsyncSession,
) -> list[MatchedTag]:
    """从用户查询中匹配标签名称。

    匹配规则：标签名出现在查询文本中即视为命中。
    只查该用户可见的标签（自己的 + 共享的）。
    """
    from app.models.tag import TagDefinition

    result = await db.execute(
        select(TagDefinition).where(
            (TagDefinition.owner_id == owner_id) | (TagDefinition.is_shared == True)
        )
    )
    tags = result.scalars().all()

    matched: list[MatchedTag] = []
    query_lower = query.lower()
    for tag in tags:
        if tag.name.lower() in query_lower:
            matched.append(MatchedTag(id=tag.id, name=tag.name, category=tag.category))

    if matched:
        logger.info("标签匹配: query='%s' -> %s", query[:50], [t.name for t in matched])

    return matched
