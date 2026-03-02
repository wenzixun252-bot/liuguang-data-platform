"""领导风格洞察 API 端点。"""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.leadership_insight import LeadershipInsight
from app.models.user import User
from app.schemas.insight import (
    CandidateOut,
    InsightGenerateRequest,
    InsightListResponse,
    InsightOut,
)
from app.services.leadership_analyzer import (
    generate_insight,
    generate_insight_stream,
    get_leadership_candidates,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/insights", tags=["洞察分析"])


@router.post("/leadership/generate", response_model=InsightOut, summary="生成领导洞察")
async def create_insight(
    body: InsightGenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """生成领导风格洞察报告（非流式）。"""
    insight = await generate_insight(
        db=db,
        analyst_user_id=current_user.feishu_open_id,
        target_user_id=body.target_user_id,
        target_user_name=body.target_user_name,
    )
    return insight


@router.post("/leadership/generate/stream", summary="流式生成领导洞察 (SSE)")
async def create_insight_stream(
    body: InsightGenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """流式生成领导风格洞察报告。"""
    async def _event_generator():
        async for chunk in generate_insight_stream(
            db=db,
            analyst_user_id=current_user.feishu_open_id,
            target_user_id=body.target_user_id,
            target_user_name=body.target_user_name,
        ):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/leadership", response_model=InsightListResponse, summary="洞察列表")
async def list_insights(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """获取用户的领导洞察列表。"""
    conditions = [LeadershipInsight.analyst_user_id == current_user.feishu_open_id]

    count_result = await db.execute(
        select(func.count()).select_from(LeadershipInsight).where(and_(*conditions))
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(LeadershipInsight)
        .where(and_(*conditions))
        .order_by(LeadershipInsight.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = result.scalars().all()

    return InsightListResponse(items=items, total=total)


@router.get("/leadership/candidates", response_model=list[CandidateOut], summary="可分析的领导列表")
async def list_candidates(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取可分析的领导候选人列表。"""
    candidates = await get_leadership_candidates(db, current_user.feishu_open_id)
    return [
        CandidateOut(
            user_id=c["name"],  # 用名字作为标识
            name=c["name"],
            meeting_count=c["meeting_count"],
            message_count=c["message_count"],
            document_count=c["document_count"],
        )
        for c in candidates
    ]


@router.get("/leadership/{insight_id}", response_model=InsightOut, summary="洞察详情")
async def get_insight(
    insight_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取洞察详情。"""
    insight = await db.get(LeadershipInsight, insight_id)
    if not insight or insight.analyst_user_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="洞察不存在")
    return insight
