"""ETL 管理接口 (仅管理员)。"""

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_role
from app.models.asset import ETLDataSource, ETLSyncState
from app.models.user import User
from app.schemas.etl import (
    DataSourceCreate,
    DataSourceOut,
    DataSourceToggle,
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
) -> list[DataSourceOut]:
    result = await db.execute(select(ETLDataSource).order_by(ETLDataSource.id))
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


# ── 同步状态 & 触发 ──


@router.get("/status", response_model=list[SyncStateOut], summary="查看所有同步状态")
async def get_sync_status(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SyncStateOut]:
    result = await db.execute(select(ETLSyncState).order_by(ETLSyncState.id))
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
