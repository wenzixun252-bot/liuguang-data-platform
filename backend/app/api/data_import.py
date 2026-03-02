"""用户级数据导入接口 — 用户自行添加飞书数据源并触发同步。"""

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.asset import ETLDataSource, ETLSyncState
from app.models.user import User
from app.schemas.etl import DataSourceOut, DataSourceWithSyncOut
from app.services.feishu import FeishuAPIError, feishu_client
from app.worker.tasks import etl_sync_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/import", tags=["数据导入"])


class BitableTableInfo(BaseModel):
    table_id: str
    name: str


class BitableAppInfo(BaseModel):
    app_token: str
    app_name: str
    tables: list[BitableTableInfo]


class FeishuSourceCreate(BaseModel):
    app_token: str
    table_id: str
    table_name: str = ""
    asset_type: str = "document"


@router.post("/feishu-source", response_model=DataSourceOut, summary="添加飞书数据源")
async def add_feishu_source(
    body: FeishuSourceCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DataSourceOut:
    """用户添加自己的飞书多维表格数据源。"""
    if body.asset_type not in ("document", "meeting", "chat_message"):
        raise HTTPException(400, "asset_type 必须是 document / meeting / chat_message")

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
        owner_id=current_user.feishu_open_id,
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return DataSourceOut.model_validate(ds)


@router.get("/feishu-sources", response_model=list[DataSourceOut], summary="查看我的数据源")
async def list_my_sources(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DataSourceOut]:
    result = await db.execute(
        select(ETLDataSource)
        .where(ETLDataSource.owner_id == current_user.feishu_open_id)
        .order_by(ETLDataSource.id)
    )
    return [DataSourceOut.model_validate(s) for s in result.scalars().all()]


@router.get("/sync-status", response_model=list[DataSourceWithSyncOut], summary="查看我的数据源同步状态")
async def get_my_sync_status(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DataSourceWithSyncOut]:
    """返回当前用户的数据源列表，附带每个数据源的同步状态。"""
    result = await db.execute(
        select(ETLDataSource)
        .where(ETLDataSource.owner_id == current_user.feishu_open_id)
        .order_by(ETLDataSource.id)
    )
    sources = result.scalars().all()

    out: list[DataSourceWithSyncOut] = []
    for ds in sources:
        # 查找对应的同步状态
        sync_result = await db.execute(
            select(ETLSyncState).where(
                ETLSyncState.source_app_token == ds.app_token,
                ETLSyncState.source_table_id == ds.table_id,
            )
        )
        sync_state = sync_result.scalar_one_or_none()

        out.append(DataSourceWithSyncOut(
            id=ds.id,
            app_token=ds.app_token,
            table_id=ds.table_id,
            table_name=ds.table_name,
            asset_type=ds.asset_type,
            owner_id=ds.owner_id,
            is_enabled=ds.is_enabled,
            created_at=ds.created_at,
            updated_at=ds.updated_at,
            last_sync_status=sync_state.last_sync_status if sync_state else None,
            last_sync_time=sync_state.last_sync_time if sync_state else None,
            records_synced=sync_state.records_synced if sync_state else 0,
            error_message=sync_state.error_message if sync_state else None,
        ))

    return out


@router.post("/feishu-sync", summary="触发我的数据源同步")
async def trigger_my_sync(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """触发当前用户的数据源同步。"""
    result = await db.execute(
        select(ETLDataSource).where(
            ETLDataSource.owner_id == current_user.feishu_open_id,
            ETLDataSource.is_enabled == True,  # noqa: E712
        )
    )
    sources = result.scalars().all()
    if not sources:
        raise HTTPException(400, "没有已启用的数据源")

    asyncio.create_task(etl_sync_job())
    return {"message": "同步任务已触发", "sources_count": len(sources)}


@router.delete("/feishu-source/{source_id}", summary="删除数据源")
async def delete_my_source(
    source_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    ds = await db.get(ETLDataSource, source_id)
    if not ds:
        raise HTTPException(404, "数据源不存在")
    if ds.owner_id != current_user.feishu_open_id and current_user.role != "admin":
        raise HTTPException(403, "无权删除此数据源")

    await db.delete(ds)
    await db.commit()
    return {"message": "已删除"}


async def _get_user_token(user: User, db: AsyncSession) -> str | None:
    """获取用户的飞书 access_token，如已过期则尝试用 refresh_token 刷新。"""
    if not user.feishu_access_token:
        return None

    # 先尝试用现有 token，如果失败再刷新
    return user.feishu_access_token


async def _refresh_and_retry(user: User, db: AsyncSession) -> str | None:
    """用 refresh_token 刷新 access_token 并更新数据库。"""
    if not user.feishu_refresh_token:
        return None
    try:
        token_data = await feishu_client.refresh_user_access_token(user.feishu_refresh_token)
        user.feishu_access_token = token_data["access_token"]
        user.feishu_refresh_token = token_data.get("refresh_token", user.feishu_refresh_token)
        await db.commit()
        return user.feishu_access_token
    except FeishuAPIError as e:
        logger.warning("刷新 user_access_token 失败: %s", e)
        return None


@router.get("/feishu-discover", response_model=list[BitableAppInfo], summary="发现可用的飞书多维表格")
async def discover_feishu_bitables(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[BitableAppInfo]:
    """列出当前用户有权限访问的飞书多维表格（不加载子表，提升速度）。

    使用用户的 user_access_token 调用飞书 API，能看到用户自己有权限的文件。
    若 token 过期会自动尝试刷新；若刷新也失败则提示重新登录。
    """
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    # 第一次尝试
    try:
        bitable_files = await feishu_client.list_drive_bitables(user_access_token=user_token)
    except FeishuAPIError:
        # token 可能过期，尝试刷新
        user_token = await _refresh_and_retry(current_user, db)
        if not user_token:
            raise HTTPException(401, "飞书授权已过期，请重新登录")
        try:
            bitable_files = await feishu_client.list_drive_bitables(user_access_token=user_token)
        except Exception as e:
            logger.error("刷新后仍失败: %s", e)
            raise HTTPException(500, f"获取飞书多维表格列表失败: {e}")
    except Exception as e:
        logger.error("发现飞书多维表格失败: %s", e)
        raise HTTPException(500, f"获取飞书多维表格列表失败: {e}")

    results: list[BitableAppInfo] = []
    for f in bitable_files:
        results.append(BitableAppInfo(
            app_token=f.get("token", ""),
            app_name=f.get("name", "未命名"),
            tables=[],  # 不预加载子表，由前端按需请求
        ))

    return results


@router.get(
    "/feishu-discover/{app_token}/tables",
    response_model=list[BitableTableInfo],
    summary="获取多维表格的数据表列表",
)
async def discover_bitable_tables(
    app_token: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[BitableTableInfo]:
    """按需加载指定多维表格下的数据表列表。"""
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    try:
        tables_raw = await feishu_client.get_bitable_tables(
            app_token, user_access_token=user_token
        )
    except FeishuAPIError:
        user_token = await _refresh_and_retry(current_user, db)
        if not user_token:
            raise HTTPException(401, "飞书授权已过期，请重新登录")
        try:
            tables_raw = await feishu_client.get_bitable_tables(
                app_token, user_access_token=user_token
            )
        except Exception as e:
            raise HTTPException(500, f"获取数据表列表失败: {e}")
    except Exception as e:
        raise HTTPException(500, f"获取数据表列表失败: {e}")

    return [
        BitableTableInfo(
            table_id=t.get("table_id", ""),
            name=t.get("name", "未命名"),
        )
        for t in tables_raw
    ]


@router.post("/feishu-sources-batch", response_model=list[DataSourceOut], summary="批量添加飞书数据源")
async def add_feishu_sources_batch(
    body: list[FeishuSourceCreate],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DataSourceOut]:
    """从选择列表批量创建数据源，跳过已存在的。"""
    created: list[DataSourceOut] = []

    for item in body:
        if item.asset_type not in ("document", "meeting", "chat_message"):
            continue

        existing = await db.execute(
            select(ETLDataSource).where(
                ETLDataSource.app_token == item.app_token,
                ETLDataSource.table_id == item.table_id,
            )
        )
        if existing.scalar_one_or_none():
            continue

        ds = ETLDataSource(
            app_token=item.app_token,
            table_id=item.table_id,
            table_name=item.table_name,
            asset_type=item.asset_type,
            owner_id=current_user.feishu_open_id,
        )
        db.add(ds)
        await db.commit()
        await db.refresh(ds)
        created.append(DataSourceOut.model_validate(ds))

    return created
