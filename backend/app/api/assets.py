"""统一看板统计接口 — 从三张表聚合统计数据。"""

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import cast, Date, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.models.chat_message import ChatMessage
from app.models.document import Document
from app.models.meeting import Meeting
from app.models.structured_table import StructuredTable
from app.models.user import User
from app.schemas.asset import AssetStatsResponse

router = APIRouter(prefix="/api/assets", tags=["统计"])


@router.get("/stats", response_model=AssetStatsResponse, summary="统一看板统计")
async def get_asset_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetStatsResponse:
    """返回三张表的聚合统计数据。"""
    visible_ids = await get_visible_owner_ids(current_user, db)

    async def _count(model) -> int:
        stmt = select(func.count()).select_from(model)
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        return (await db.execute(stmt)).scalar() or 0

    async def _today_count(model) -> int:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = select(func.count()).select_from(model).where(model.created_at >= today_start)
        if visible_ids is not None:
            stmt = stmt.where(model.owner_id.in_(visible_ids))
        return (await db.execute(stmt)).scalar() or 0

    doc_count = await _count(Document)
    meeting_count = await _count(Meeting)
    chat_count = await _count(ChatMessage)
    table_count = await _count(StructuredTable)

    total = doc_count + meeting_count + chat_count + table_count
    by_table = {
        "documents": doc_count,
        "meetings": meeting_count,
        "chat_messages": chat_count,
        "tables": table_count,
    }

    today_new = {
        "documents": await _today_count(Document),
        "meetings": await _today_count(Meeting),
        "chat_messages": await _today_count(ChatMessage),
        "tables": await _today_count(StructuredTable),
    }

    # 近30天趋势（基于 documents 表的 created_at）
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    trend_stmt = (
        select(
            cast(Document.created_at, Date).label("date"),
            func.count().label("count"),
        )
        .where(Document.created_at >= thirty_days_ago)
        .group_by(cast(Document.created_at, Date))
        .order_by(cast(Document.created_at, Date))
    )
    if visible_ids is not None:
        trend_stmt = trend_stmt.where(Document.owner_id.in_(visible_ids))

    trend_rows = (await db.execute(trend_stmt)).all()
    recent_trend = [{"date": str(row[0]), "count": row[1]} for row in trend_rows]

    return AssetStatsResponse(total=total, by_table=by_table, today_new=today_new, recent_trend=recent_trend)
