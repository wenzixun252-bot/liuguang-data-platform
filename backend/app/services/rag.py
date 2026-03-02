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


def _build_owner_filter(visible_ids: list[str] | None) -> tuple[str, dict]:
    """构建 owner_id 过滤子句。"""
    if visible_ids is None:
        return "TRUE", {}
    placeholders = ", ".join(f":vid_{i}" for i in range(len(visible_ids)))
    params = {f"vid_{i}": vid for i, vid in enumerate(visible_ids)}
    return f"owner_id IN ({placeholders})", params


# ── 向量检索 ─────────────────────────────────────────────


class VectorSearcher:
    """权限感知的跨三表向量检索。"""

    async def search(
        self,
        query_text: str,
        visible_ids: list[str] | None,
        db: AsyncSession,
        top_k: int = 10,
    ) -> list[SearchResult]:
        query_embedding = await llm_client.generate_embedding(query_text)
        vector_str = f"[{','.join(str(v) for v in query_embedding)}]"

        owner_filter, owner_params = _build_owner_filter(visible_ids)

        sql = text(f"""
            SELECT id, source_table, title, content_text, owner_id, distance FROM (
                SELECT id, 'document' as source_table, title, content_text, owner_id,
                       content_vector <=> :query_vector AS distance
                FROM documents
                WHERE content_vector IS NOT NULL AND {owner_filter}
                UNION ALL
                SELECT id, 'meeting' as source_table, title, content_text, owner_id,
                       content_vector <=> :query_vector AS distance
                FROM meetings
                WHERE content_vector IS NOT NULL AND {owner_filter}
                UNION ALL
                SELECT id, 'chat_message' as source_table, NULL as title, content_text, owner_id,
                       content_vector <=> :query_vector AS distance
                FROM chat_messages
                WHERE content_vector IS NOT NULL AND {owner_filter}
            ) combined
            ORDER BY distance ASC
            LIMIT :top_k
        """)

        params = {"query_vector": vector_str, "top_k": top_k, **owner_params}
        result = await db.execute(sql, params)
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
    ) -> list[SearchResult]:
        owner_filter, owner_params = _build_owner_filter(visible_ids)

        sql = text(f"""
            SELECT id, source_table, title, content_text, owner_id, rank FROM (
                SELECT id, 'document' as source_table, title, content_text, owner_id,
                       ts_rank_cd(
                           to_tsvector('simple', coalesce(title, '') || ' ' || content_text),
                           plainto_tsquery('simple', :query)
                       ) AS rank
                FROM documents
                WHERE to_tsvector('simple', coalesce(title, '') || ' ' || content_text)
                      @@ plainto_tsquery('simple', :query)
                  AND {owner_filter}
                UNION ALL
                SELECT id, 'meeting' as source_table, title, content_text, owner_id,
                       ts_rank_cd(
                           to_tsvector('simple', coalesce(title, '') || ' ' || content_text),
                           plainto_tsquery('simple', :query)
                       ) AS rank
                FROM meetings
                WHERE to_tsvector('simple', coalesce(title, '') || ' ' || content_text)
                      @@ plainto_tsquery('simple', :query)
                  AND {owner_filter}
                UNION ALL
                SELECT id, 'chat_message' as source_table, NULL as title, content_text, owner_id,
                       ts_rank_cd(
                           to_tsvector('simple', content_text),
                           plainto_tsquery('simple', :query)
                       ) AS rank
                FROM chat_messages
                WHERE to_tsvector('simple', content_text)
                      @@ plainto_tsquery('simple', :query)
                  AND {owner_filter}
            ) combined
            ORDER BY rank DESC
            LIMIT :top_k
        """)

        params = {"query": query_text, "top_k": top_k, **owner_params}
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
    ) -> list[SearchResult]:
        vector_results = await self.vector_searcher.search(
            query_text, visible_ids, db, top_k=top_k * 2
        )
        bm25_results = await self.bm25_searcher.search(
            query_text, visible_ids, db, top_k=top_k * 2
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
