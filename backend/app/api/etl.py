"""ETL 管理接口 (仅管理员)。"""

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_role
from app.models.asset import ETLDataSource, ETLSyncState
from app.models.user import User
from app.schemas.etl import (
    DataSourceCreate,
    DataSourceOut,
    DataSourceToggle,
    DataSourceWithSyncOut,
    ETLTriggerResponse,
    SyncStateOut,
)
from app.worker.tasks import etl_sync_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/etl", tags=["ETL 管理"])


# ── 数据源管理 CRUD ──


@router.get("/sources", response_model=list[DataSourceOut], summary="查看所有数据源")
async def list_sources(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
    search: str | None = Query(None),
) -> list[DataSourceOut]:
    stmt = select(ETLDataSource)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            ETLDataSource.table_name.ilike(like) | ETLDataSource.asset_type.ilike(like)
        )
    result = await db.execute(stmt.order_by(ETLDataSource.id))
    return [DataSourceOut.model_validate(s) for s in result.scalars().all()]


@router.post("/sources", response_model=DataSourceOut, summary="添加数据源")
async def create_source(
    body: DataSourceCreate,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DataSourceOut:
    # 检查是否已存在
    existing = await db.execute(
        select(ETLDataSource).where(
            ETLDataSource.app_token == body.app_token,
            ETLDataSource.table_id == body.table_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "该数据源已存在")

    ds = ETLDataSource(
        app_token=body.app_token,
        table_id=body.table_id,
        table_name=body.table_name,
        asset_type=body.asset_type,
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return DataSourceOut.model_validate(ds)


@router.patch("/sources/{source_id}", response_model=DataSourceOut, summary="启用/禁用数据源")
async def toggle_source(
    source_id: int,
    body: DataSourceToggle,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DataSourceOut:
    ds = await db.get(ETLDataSource, source_id)
    if not ds:
        raise HTTPException(404, "数据源不存在")
    ds.is_enabled = body.is_enabled
    await db.commit()
    await db.refresh(ds)
    return DataSourceOut.model_validate(ds)


@router.delete("/sources/{source_id}", summary="删除数据源")
async def delete_source(
    source_id: int,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    ds = await db.get(ETLDataSource, source_id)
    if not ds:
        raise HTTPException(404, "数据源不存在")
    await db.delete(ds)
    await db.commit()
    return {"message": "已删除"}


class BatchDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/sources/batch-delete", summary="批量删除数据源")
async def batch_delete_sources(
    body: BatchDeleteRequest,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """批量删除数据源（仅管理员）。"""
    result = await db.execute(
        select(ETLDataSource).where(ETLDataSource.id.in_(body.ids))
    )
    rows = result.scalars().all()

    for row in rows:
        await db.delete(row)

    await db.commit()
    return {"deleted": len(rows)}


@router.get("/sources-with-status", response_model=list[DataSourceWithSyncOut], summary="数据源+同步状态合并视图")
async def list_sources_with_status(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DataSourceWithSyncOut]:
    """返回所有数据源及其对应的同步状态，一行一个数据源。"""
    sources_result = await db.execute(select(ETLDataSource).order_by(ETLDataSource.id))
    sources = sources_result.scalars().all()

    # 预加载所有同步状态，以 (app_token, table_id) 为 key
    states_result = await db.execute(select(ETLSyncState))
    states_map: dict[tuple[str, str], ETLSyncState] = {}
    for st in states_result.scalars().all():
        states_map[(st.source_app_token, st.source_table_id)] = st

    # 预加载用户名
    from app.models.user import User as UserModel
    owner_ids = {s.owner_id for s in sources if s.owner_id}
    users_map: dict[str, str] = {}
    if owner_ids:
        users_result = await db.execute(
            select(UserModel).where(UserModel.feishu_open_id.in_(owner_ids))
        )
        for u in users_result.scalars().all():
            users_map[u.feishu_open_id] = u.name

    merged: list[DataSourceWithSyncOut] = []
    for s in sources:
        state = states_map.get((s.app_token, s.table_id))
        merged.append(DataSourceWithSyncOut(
            id=s.id,
            app_token=s.app_token,
            table_id=s.table_id,
            table_name=s.table_name,
            asset_type=s.asset_type,
            owner_id=s.owner_id,
            owner_name=users_map.get(s.owner_id, None) if s.owner_id else None,
            is_enabled=s.is_enabled,
            created_at=s.created_at,
            updated_at=s.updated_at,
            last_sync_status=state.last_sync_status if state else None,
            last_sync_time=state.last_sync_time if state else None,
            records_synced=state.records_synced if state else 0,
            error_message=state.error_message if state else None,
        ))
    return merged


# ── 同步状态 & 触发 ──


@router.get("/status", response_model=list[SyncStateOut], summary="查看所有同步状态")
async def get_sync_status(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SyncStateOut]:
    # 只返回有对应数据源的同步状态，过滤掉孤立记录
    result = await db.execute(
        select(ETLSyncState).where(
            ETLSyncState.source_app_token.in_(
                select(ETLDataSource.app_token)
            ),
            ETLSyncState.source_table_id.in_(
                select(ETLDataSource.table_id)
            ),
        ).order_by(ETLSyncState.id)
    )
    return [SyncStateOut.model_validate(s) for s in result.scalars().all()]


@router.post("/trigger", response_model=ETLTriggerResponse, summary="手动触发 ETL 同步")
async def trigger_etl(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ETLTriggerResponse:
    """手动触发一次全量 ETL 同步（后台执行）。"""
    # 从本地数据源表读取启用的数据源数量
    result = await db.execute(
        select(ETLDataSource).where(ETLDataSource.is_enabled == True)  # noqa: E712
    )
    sources = result.scalars().all()
    if not sources:
        raise HTTPException(400, "没有已启用的数据源，请先添加数据源")

    asyncio.create_task(etl_sync_job())
    return ETLTriggerResponse(
        message="ETL 同步任务已触发",
        sources_count=len(sources),
    )
