"""RAG 检索引擎 — 权限感知的跨三表混合检索 (Vector + BM25 + RRF)。"""

import logging
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.llm import llm_client

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """单条检索结果。"""

    id: int
    source_table: str  # 'document' | 'meeting' | 'chat_message'
    title: str | None
    content_text: str
    owner_id: str
    score: float = 0.0


# 所有可搜索的表
ALL_SOURCE_TABLES = ["document", "meeting", "chat_message"]

# 表名到实际数据库表名的映射
_TABLE_MAP = {
    "document": "documents",
    "meeting": "meetings",
    "chat_message": "chat_messages",
}


def _build_owner_filter(visible_ids: list[str] | None) -> tuple[str, dict]:
    """构建 owner_id 过滤子句。"""
    if visible_ids is None:
        return "TRUE", {}
    placeholders = ", ".join(f":vid_{i}" for i in range(len(visible_ids)))
    params = {f"vid_{i}": vid for i, vid in enumerate(visible_ids)}
    return f"owner_id IN ({placeholders})", params


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
            all_params.update(id_params)

            title_col = "NULL as title" if table_key == "chat_message" else "title"
            unions.append(
                f"SELECT id, '{table_key}' as source_table, {title_col}, content_text, owner_id, "
                f"content_vector <=> :query_vector AS distance "
                f"FROM {db_table} "
                f"WHERE content_vector IS NOT NULL AND {owner_filter} AND {id_filter}"
            )

        if not unions:
            return []

        sql = text(
            f"SELECT id, source_table, title, content_text, owner_id, distance FROM ("
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
            )
            for row in rows
        ]


# ── BM25 关键词检索 ──────────────────────────────────────


class BM25Searcher:
    """权限感知的跨三表全文关键词检索。"""

    async def search(
        self,
        query_text: str,
        visible_ids: list[str] | None,
        db: AsyncSession,
        top_k: int = 10,
        source_tables: list[str] | None = None,
        source_ids: list[tuple[str, int]] | None = None,
    ) -> list[SearchResult]:
        owner_filter, owner_params = _build_owner_filter(visible_ids)
        tables = _get_tables_to_search(source_tables, source_ids)

        unions = []
        all_params: dict = {"query": query_text, "top_k": top_k, **owner_params}

        for table_key in tables:
            db_table = _TABLE_MAP[table_key]
            id_filter, id_params = _build_id_filter(table_key, source_ids)
            all_params.update(id_params)

            title_col = "NULL as title" if table_key == "chat_message" else "title"
            ts_content = (
                "content_text" if table_key == "chat_message"
                else "coalesce(title, '') || ' ' || content_text"
            )
            unions.append(
                f"SELECT id, '{table_key}' as source_table, {title_col}, content_text, owner_id, "
                f"ts_rank_cd(to_tsvector('simple', {ts_content}), plainto_tsquery('simple', :query)) AS rank "
                f"FROM {db_table} "
                f"WHERE to_tsvector('simple', {ts_content}) @@ plainto_tsquery('simple', :query) "
                f"AND {owner_filter} AND {id_filter}"
            )

        if not unions:
            return []

        sql = text(
            f"SELECT id, source_table, title, content_text, owner_id, rank FROM ("
            f"{' UNION ALL '.join(unions)}"
            f") combined ORDER BY rank DESC LIMIT :top_k"
        )

        params = all_params
        result = await db.execute(sql, params)
        rows = result.fetchall()

        return [
            SearchResult(
                id=row.id,
                source_table=row.source_table,
                title=row.title,
                content_text=row.content_text,
                owner_id=row.owner_id,
                score=float(row.rank),
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
    ) -> list[SearchResult]:
        vector_results = await self.vector_searcher.search(
            query_text, visible_ids, db, top_k=top_k * 2,
            source_tables=source_tables, source_ids=source_ids,
        )
        bm25_results = await self.bm25_searcher.search(
            query_text, visible_ids, db, top_k=top_k * 2,
            source_tables=source_tables, source_ids=source_ids,
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

        sorted_keys = sorted(rrf_scores, key=rrf_scores.get, reverse=True)[:top_k]

        results = []
        for key in sorted_keys:
            r = result_map[key]
            r.score = rrf_scores[key]
            results.append(r)

        logger.info(
            "混合检索完成: vector=%d, bm25=%d, merged=%d",
            len(vector_results),
            len(bm25_results),
            len(results),
        )
        return results


# 模块级单例
hybrid_searcher = HybridSearcher()
