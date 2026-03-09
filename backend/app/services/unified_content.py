"""统一内容服务 — 跨表搜索 + 标签过滤。"""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def unified_search(
    db: AsyncSession,
    keyword: str | None = None,
    tag_ids: list[int] | None = None,
    content_types: list[str] | None = None,
    visible_ids: list[str] | None = None,
    page: int = 1,
    page_size: int = 20,
) -> list[dict]:
    """统一搜索：跨 documents/meetings/chat_messages/structured_tables 查询。

    支持关键词、标签过滤、内容类型过滤、权限过滤。
    """
    conditions = []
    params: dict = {}

    # 权限过滤
    if visible_ids is not None:
        vid_placeholders = ", ".join(f":vid_{i}" for i in range(len(visible_ids)))
        conditions.append(f"owner_id IN ({vid_placeholders})")
        for i, vid in enumerate(visible_ids):
            params[f"vid_{i}"] = vid

    # 内容类型过滤
    allowed_types = content_types or ["document", "communication", "structured_table"]

    # 标签过滤子查询
    tag_filter = ""
    if tag_ids:
        tid_placeholders = ", ".join(f":tid_{i}" for i in range(len(tag_ids)))
        tag_filter = (
            f"AND (content_type, id) IN ("
            f"SELECT content_type, content_id FROM content_tags "
            f"WHERE tag_id IN ({tid_placeholders}))"
        )
        for i, tid in enumerate(tag_ids):
            params[f"tid_{i}"] = tid

    # 关键词过滤
    keyword_filter = ""
    if keyword:
        keyword_filter = "AND (title ILIKE :kw OR content_text ILIKE :kw)"
        params["kw"] = f"%{keyword}%"

    where_clause = " AND ".join(conditions) if conditions else "TRUE"

    # 构建 UNION ALL 查询
    unions = []
    type_map = {
        "document": (
            "SELECT id, 'document' AS content_type, owner_id, title, "
            "LEFT(content_text, 200) AS content_text, created_at, updated_at "
            "FROM documents"
        ),
        "communication": (
            "SELECT id, 'communication' AS content_type, owner_id, title, "
            "LEFT(content_text, 200) AS content_text, created_at, updated_at "
            "FROM communications"
        ),
        "structured_table": (
            "SELECT id, 'structured_table' AS content_type, owner_id, name AS title, "
            "COALESCE(summary, '') AS content_text, created_at, updated_at "
            "FROM structured_tables WHERE summary IS NOT NULL"
        ),
    }

    for t in allowed_types:
        if t in type_map:
            unions.append(type_map[t])

    if not unions:
        return []

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    sql = text(
        f"SELECT * FROM ({' UNION ALL '.join(unions)}) AS uc "
        f"WHERE {where_clause} {keyword_filter} {tag_filter} "
        f"ORDER BY updated_at DESC LIMIT :limit OFFSET :offset"
    )

    result = await db.execute(sql, params)
    rows = result.fetchall()

    return [
        {
            "id": row.id,
            "content_type": row.content_type,
            "owner_id": row.owner_id,
            "title": row.title,
            "content_text": row.content_text,
            "created_at": str(row.created_at) if row.created_at else None,
            "updated_at": str(row.updated_at) if row.updated_at else None,
        }
        for row in rows
    ]


async def get_tags_for_content(
    db: AsyncSession,
    items: list[dict],
) -> dict[str, list[dict]]:
    """批量获取内容的标签。返回 {content_type:content_id -> [tag_info]} 映射。"""
    if not items:
        return {}

    # 构建查询条件
    or_parts = []
    params: dict = {}
    for i, item in enumerate(items):
        or_parts.append(f"(ct.content_type = :ct_{i} AND ct.content_id = :cid_{i})")
        params[f"ct_{i}"] = item["content_type"]
        params[f"cid_{i}"] = item["id"]

    sql = text(
        f"SELECT ct.content_type, ct.content_id, td.id AS tag_id, td.name, td.color "
        f"FROM content_tags ct "
        f"JOIN tag_definitions td ON ct.tag_id = td.id "
        f"WHERE {' OR '.join(or_parts)}"
    )

    result = await db.execute(sql, params)
    tag_map: dict[str, list[dict]] = {}
    for row in result.fetchall():
        key = f"{row.content_type}:{row.content_id}"
        tag_map.setdefault(key, []).append({
            "tag_id": row.tag_id,
            "name": row.name,
            "color": row.color,
        })
    return tag_map
