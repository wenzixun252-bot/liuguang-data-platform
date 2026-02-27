"""RAG 检索引擎 — 权限感知的混合检索 (Vector + BM25 + RRF)。"""

import logging
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.llm import llm_client

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """单条检索结果。"""

    feishu_record_id: str
    title: str | None
    content_text: str
    asset_type: str
    owner_id: str
    score: float = 0.0


# ── 向量检索 ─────────────────────────────────────────────


class VectorSearcher:
    """权限感知的向量检索。"""

    async def search(
        self,
        query_text: str,
        user_open_id: str,
        user_role: str,
        db: AsyncSession,
        top_k: int = 10,
    ) -> list[SearchResult]:
        """向量相似度检索，强制附加权限过滤。"""
        query_embedding = await llm_client.generate_embedding(query_text)
        vector_str = f"[{','.join(str(v) for v in query_embedding)}]"

        is_privileged = user_role in ("admin", "executive")

        sql = text("""
            SELECT feishu_record_id, title, content_text, asset_type, owner_id,
                   content_vector <=> :query_vector AS distance
            FROM data_assets
            WHERE content_vector IS NOT NULL
              AND (:is_privileged OR owner_id = :user_open_id)
            ORDER BY distance ASC
            LIMIT :top_k
        """)

        result = await db.execute(
            sql,
            {
                "query_vector": vector_str,
                "is_privileged": is_privileged,
                "user_open_id": user_open_id,
                "top_k": top_k,
            },
        )
        rows = result.fetchall()

        return [
            SearchResult(
                feishu_record_id=row.feishu_record_id,
                title=row.title,
                content_text=row.content_text,
                asset_type=row.asset_type,
                owner_id=row.owner_id,
                score=1.0 / (1.0 + row.distance),  # 转为相似度分数
            )
            for row in rows
        ]


# ── BM25 关键词检索 ──────────────────────────────────────


class BM25Searcher:
    """权限感知的全文关键词检索 (PostgreSQL ts_vector + ts_rank_cd)。"""

    async def search(
        self,
        query_text: str,
        user_open_id: str,
        user_role: str,
        db: AsyncSession,
        top_k: int = 10,
    ) -> list[SearchResult]:
        """BM25 关键词检索。"""
        is_privileged = user_role in ("admin", "executive")

        sql = text("""
            SELECT feishu_record_id, title, content_text, asset_type, owner_id,
                   ts_rank_cd(
                       to_tsvector('simple', coalesce(title, '') || ' ' || content_text),
                       plainto_tsquery('simple', :query)
                   ) AS rank
            FROM data_assets
            WHERE to_tsvector('simple', coalesce(title, '') || ' ' || content_text)
                  @@ plainto_tsquery('simple', :query)
              AND (:is_privileged OR owner_id = :user_open_id)
            ORDER BY rank DESC
            LIMIT :top_k
        """)

        result = await db.execute(
            sql,
            {
                "query": query_text,
                "is_privileged": is_privileged,
                "user_open_id": user_open_id,
                "top_k": top_k,
            },
        )
        rows = result.fetchall()

        return [
            SearchResult(
                feishu_record_id=row.feishu_record_id,
                title=row.title,
                content_text=row.content_text,
                asset_type=row.asset_type,
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
        self.k = k  # RRF 常数

    async def search(
        self,
        query_text: str,
        user_open_id: str,
        user_role: str,
        db: AsyncSession,
        top_k: int = 5,
    ) -> list[SearchResult]:
        """执行混合检索并返回 RRF 排序结果。"""
        # 两路并行检索（各取更多候选）
        vector_results = await self.vector_searcher.search(
            query_text, user_open_id, user_role, db, top_k=top_k * 2
        )
        bm25_results = await self.bm25_searcher.search(
            query_text, user_open_id, user_role, db, top_k=top_k * 2
        )

        # RRF 融合
        rrf_scores: dict[str, float] = {}
        result_map: dict[str, SearchResult] = {}

        for rank, r in enumerate(vector_results):
            rrf_scores[r.feishu_record_id] = rrf_scores.get(r.feishu_record_id, 0) + 1.0 / (self.k + rank + 1)
            result_map[r.feishu_record_id] = r

        for rank, r in enumerate(bm25_results):
            rrf_scores[r.feishu_record_id] = rrf_scores.get(r.feishu_record_id, 0) + 1.0 / (self.k + rank + 1)
            if r.feishu_record_id not in result_map:
                result_map[r.feishu_record_id] = r

        # 按 RRF 分数排序，取 top_k
        sorted_ids = sorted(rrf_scores, key=rrf_scores.get, reverse=True)[:top_k]

        results = []
        for rid in sorted_ids:
            r = result_map[rid]
            r.score = rrf_scores[rid]
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
