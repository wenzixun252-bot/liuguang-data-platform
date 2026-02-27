"""ETL 管理接口 (仅管理员)。"""

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_role
from app.models.asset import ETLSyncState
from app.models.user import User
from app.schemas.etl import ETLTriggerResponse, RegistryEntryOut, SyncStateOut
from app.services.etl.extractor import registry_reader
from app.worker.tasks import etl_sync_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/etl", tags=["ETL 管理"])


@router.get("/status", response_model=list[SyncStateOut], summary="查看所有同步状态")
async def get_sync_status(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SyncStateOut]:
    """返回所有数据源的同步状态。"""
    result = await db.execute(select(ETLSyncState).order_by(ETLSyncState.id))
    states = result.scalars().all()
    return [SyncStateOut.model_validate(s) for s in states]


@router.post("/trigger", response_model=ETLTriggerResponse, summary="手动触发 ETL 同步")
async def trigger_etl(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
) -> ETLTriggerResponse:
    """手动触发一次全量 ETL 同步（后台执行）。"""
    entries = await registry_reader.read()
    # 在后台异步执行，不阻塞请求
    asyncio.create_task(etl_sync_job())
    return ETLTriggerResponse(
        message="ETL 同步任务已触发",
        sources_count=len(entries),
    )


@router.get("/registry", response_model=list[RegistryEntryOut], summary="查看注册中心内容")
async def get_registry(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
) -> list[RegistryEntryOut]:
    """查看当前注册中心中的数据源配置。"""
    entries = await registry_reader.read()
    return [
        RegistryEntryOut(
            app_token=e.app_token,
            table_id=e.table_id,
            table_name=e.table_name,
            asset_type=e.asset_type,
            is_enabled=e.is_enabled,
        )
        for e in entries
    ]
