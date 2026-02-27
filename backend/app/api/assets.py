"""数据资产管理接口 — 看板统计、列表、详情。"""

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.asset import DataAsset
from app.models.user import User
from app.schemas.asset import AssetListResponse, AssetOut, AssetStatsResponse

router = APIRouter(prefix="/api/assets", tags=["数据资产"])


def _apply_rls(stmt, user: User):
    """对查询附加行级安全过滤。"""
    if user.role not in ("admin", "executive"):
        stmt = stmt.where(DataAsset.owner_id == user.feishu_open_id)
    return stmt


@router.get("/stats", response_model=AssetStatsResponse, summary="资产统计")
async def get_asset_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetStatsResponse:
    """返回当前用户的资产统计数据。"""
    # 总数
    total_stmt = select(func.count()).select_from(DataAsset)
    total_stmt = _apply_rls(total_stmt, current_user)
    total = (await db.execute(total_stmt)).scalar() or 0

    # 按类型分组
    type_stmt = select(DataAsset.asset_type, func.count()).group_by(DataAsset.asset_type)
    type_stmt = _apply_rls(type_stmt, current_user)
    type_rows = (await db.execute(type_stmt)).all()
    by_type = {row[0]: row[1] for row in type_rows}

    # 近30天趋势
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    trend_stmt = (
        select(
            cast(DataAsset.synced_at, Date).label("date"),
            func.count().label("count"),
        )
        .where(DataAsset.synced_at >= thirty_days_ago)
        .group_by(cast(DataAsset.synced_at, Date))
        .order_by(cast(DataAsset.synced_at, Date))
    )
    trend_stmt = _apply_rls(trend_stmt, current_user)
    trend_rows = (await db.execute(trend_stmt)).all()
    recent_trend = [{"date": str(row[0]), "count": row[1]} for row in trend_rows]

    return AssetStatsResponse(total=total, by_type=by_type, recent_trend=recent_trend)


@router.get("/list", response_model=AssetListResponse, summary="资产列表")
async def list_assets(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    asset_type: str | None = Query(None),
) -> AssetListResponse:
    """分页查询资产列表，支持搜索和类型筛选。"""
    base = select(DataAsset)
    base = _apply_rls(base, current_user)

    count_stmt = select(func.count()).select_from(DataAsset)
    count_stmt = _apply_rls(count_stmt, current_user)

    if search:
        like_pattern = f"%{search}%"
        search_filter = DataAsset.title.ilike(like_pattern) | DataAsset.content_text.ilike(like_pattern)
        base = base.where(search_filter)
        count_stmt = count_stmt.where(search_filter)

    if asset_type:
        base = base.where(DataAsset.asset_type == asset_type)
        count_stmt = count_stmt.where(DataAsset.asset_type == asset_type)

    total = (await db.execute(count_stmt)).scalar() or 0

    items_stmt = base.order_by(DataAsset.synced_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(items_stmt)).scalars().all()

    return AssetListResponse(
        items=[AssetOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{record_id}", response_model=AssetOut, summary="资产详情")
async def get_asset_detail(
    record_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetOut:
    """获取单条资产详情。"""
    stmt = select(DataAsset).where(DataAsset.feishu_record_id == record_id)
    stmt = _apply_rls(stmt, current_user)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="资产不存在或无权访问")
    return AssetOut.model_validate(row)
