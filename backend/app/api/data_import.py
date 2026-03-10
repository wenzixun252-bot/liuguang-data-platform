"""用户级数据导入接口 — 用户自行添加飞书数据源并触发同步。"""

import asyncio
import logging
from datetime import datetime, timedelta

from app.schemas.types import UTCDatetime, UTCDatetimeOpt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_user_feishu_token, refresh_user_feishu_token
from app.models.asset import ETLDataSource, ETLSyncState, CloudFolderSource, ImportTask, SchemaMappingCache
from app.models.document import Document
from app.models.user import User
from app.schemas.etl import DataSourceOut, DataSourceWithSyncOut
from app.services.feishu import FeishuAPIError, feishu_client
from app.services.cloud_doc_import import cloud_doc_import_service
from app.worker.tasks import etl_sync_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/import", tags=["数据导入"])


class BitableTableInfo(BaseModel):
    table_id: str
    name: str


class BitableAppInfo(BaseModel):
    app_token: str
    app_name: str
    type: str = "bitable"  # "bitable" | "spreadsheet"
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
    if body.asset_type not in ("document", "communication", "structured"):
        raise HTTPException(400, "asset_type 必须是 document / communication / structured")

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
    asset_type: str | None = Query(None, description="可选：按 asset_type 过滤"),
) -> list[DataSourceWithSyncOut]:
    """返回当前用户的数据源列表，附带每个数据源的同步状态。"""
    query = (
        select(ETLDataSource)
        .where(ETLDataSource.owner_id == current_user.feishu_open_id)
        .order_by(ETLDataSource.id)
    )
    if asset_type:
        query = query.where(ETLDataSource.asset_type == asset_type)
    result = await db.execute(query)
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

    # 清理超过 10 分钟仍为 running 的卡住状态
    stale_cutoff = datetime.utcnow() - timedelta(minutes=10)
    stale_result = await db.execute(
        select(ETLSyncState).where(
            ETLSyncState.last_sync_status == "running",
            ETLSyncState.updated_at < stale_cutoff,
        )
    )
    for state in stale_result.scalars().all():
        state.last_sync_status = "failed"
        state.error_message = "同步超时，已自动标记为失败"
        state.last_sync_time = datetime.utcnow()
    await db.commit()

    asyncio.create_task(etl_sync_job())
    return {"message": "同步任务已触发", "sources_count": len(sources)}


@router.post("/feishu-sync/{source_id}", summary="触发单个数据源同步")
async def trigger_single_sync(
    source_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """触发指定数据源的同步。"""
    ds = await db.get(ETLDataSource, source_id)
    if not ds:
        raise HTTPException(404, "数据源不存在")
    if ds.owner_id != current_user.feishu_open_id and current_user.role != "admin":
        raise HTTPException(403, "无权操作此数据源")

    if ds.asset_type == "structured":
        # 结构化数据源走专用的 structured_table_import 服务
        asyncio.create_task(_sync_structured_source(ds, current_user.feishu_access_token))
    else:
        from app.worker.tasks import etl_sync_single_source
        asyncio.create_task(etl_sync_single_source(ds.app_token, ds.table_id, ds.owner_id, ds.asset_type))
    return {"message": "同步任务已触发", "source_id": source_id}


async def _sync_structured_source(ds: ETLDataSource, user_access_token: str | None) -> None:
    """后台同步结构化数据源（多维表格/飞书表格）到 StructuredTable。"""
    from app.database import async_session
    from app.services.structured_table_import import import_from_bitable, import_from_spreadsheet

    async with async_session() as db:
        try:
            # 更新同步状态为 running
            result = await db.execute(
                select(ETLSyncState).where(
                    ETLSyncState.source_app_token == ds.app_token,
                    ETLSyncState.source_table_id == ds.table_id,
                )
            )
            state = result.scalar_one_or_none()
            if state:
                state.last_sync_status = "running"
                state.error_message = None
            else:
                state = ETLSyncState(
                    source_app_token=ds.app_token,
                    source_table_id=ds.table_id,
                    last_sync_status="running",
                )
                db.add(state)
            await db.commit()

            # 获取用户 token（如果调用时没传，从用户表查）
            token = user_access_token
            if not token and ds.owner_id:
                from app.worker.tasks import _resolve_user_token
                token = await _resolve_user_token(ds.owner_id, db)

            # 根据表格类型调用对应的导入函数
            # 判断方式：尝试先用 bitable API，失败则回滚后用 spreadsheet
            table_obj = None
            try:
                table_obj = await import_from_bitable(
                    db, ds.owner_id, ds.app_token, ds.table_id, user_access_token=token,
                )
            except Exception as bitable_err:
                logger.warning("bitable 导入失败，尝试 spreadsheet: %s", bitable_err)
                await db.rollback()
                try:
                    table_obj = await import_from_spreadsheet(
                        db, ds.owner_id, ds.app_token, ds.table_id, user_access_token=token,
                    )
                except Exception as sheet_err:
                    raise ValueError(
                        f"多维表格导入失败: {bitable_err}; 飞书表格导入也失败: {sheet_err}"
                    ) from sheet_err

            # 更新同步状态为成功
            result = await db.execute(
                select(ETLSyncState).where(
                    ETLSyncState.source_app_token == ds.app_token,
                    ETLSyncState.source_table_id == ds.table_id,
                )
            )
            state = result.scalar_one_or_none()
            if state:
                state.last_sync_status = "success"
                state.last_sync_time = datetime.utcnow()
                state.records_synced = table_obj.row_count
                state.error_message = None
                await db.commit()

            logger.info("结构化数据源同步成功: %s/%s, %d 行", ds.app_token, ds.table_id, table_obj.row_count)

        except Exception as e:
            logger.error("结构化数据源同步失败: %s/%s: %s", ds.app_token, ds.table_id, e, exc_info=True)
            try:
                await db.rollback()
                result = await db.execute(
                    select(ETLSyncState).where(
                        ETLSyncState.source_app_token == ds.app_token,
                        ETLSyncState.source_table_id == ds.table_id,
                    )
                )
                state = result.scalar_one_or_none()
                if state:
                    state.last_sync_status = "failed"
                    state.error_message = str(e)[:500]
                    state.last_sync_time = datetime.utcnow()
                    await db.commit()
            except Exception:
                pass


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

    # 同时清理对应的同步状态和 Schema 缓存，避免重新添加时残留旧状态
    sync_result = await db.execute(
        select(ETLSyncState).where(
            ETLSyncState.source_app_token == ds.app_token,
            ETLSyncState.source_table_id == ds.table_id,
        )
    )
    sync_state = sync_result.scalar_one_or_none()
    if sync_state:
        await db.delete(sync_state)

    cache_result = await db.execute(
        select(SchemaMappingCache).where(
            SchemaMappingCache.source_app_token == ds.app_token,
            SchemaMappingCache.source_table_id == ds.table_id,
        )
    )
    for cache in cache_result.scalars().all():
        await db.delete(cache)

    await db.delete(ds)
    await db.commit()
    return {"message": "已删除"}


# 兼容别名，统一使用 deps 中的共享函数
_get_user_token = get_user_feishu_token
_refresh_and_retry = refresh_user_feishu_token


@router.get("/feishu-discover", response_model=list[BitableAppInfo], summary="发现可用的飞书多维表格和表格")
async def discover_feishu_bitables(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(default="", description="搜索关键词，空则返回全部可访问表格"),
) -> list[BitableAppInfo]:
    """发现用户有权限访问的所有多维表格 + 飞书表格（云盘 + 知识空间 + 他人分享）。

    - 无搜索词：list API（自己云空间）+ 知识空间 + 搜索 API（发现共享的表格）
    - 有搜索词：搜索 API 只搜 bitable/sheet，按文件名匹配度排序
    """
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    results: list[BitableAppInfo] = []
    seen_tokens: set[str] = set()

    # 允许的类型：bitable、sheet 以及 wiki（wiki 内嵌的多维表格/飞书表格搜索时返回 wiki 类型）
    TABLE_TYPES = {"bitable", "sheet", "wiki"}
    doc_type_map = {"bitable": "bitable", "sheet": "spreadsheet", "wiki": "wiki"}

    def _add(token: str, name: str, type_: str) -> None:
        if token and token not in seen_tokens:
            seen_tokens.add(token)
            results.append(BitableAppInfo(
                app_token=token, app_name=name or "未命名", type=type_, tables=[],
            ))

    def _add_from_search(files: list[dict]) -> None:
        """从搜索结果中只添加表格类型。"""
        for f in files:
            t = f.get("token", "")
            raw_type = f.get("type", "")
            if raw_type not in TABLE_TYPES:
                continue
            _add(t, f.get("name", ""), doc_type_map.get(raw_type, raw_type))

    keyword = q.strip()

    async def _collect_all(token: str, name_filter: str = "") -> None:
        """收集所有可访问的表格。name_filter 非空时只保留文件名包含该关键词的。"""
        import httpx
        kw = name_filter.lower()

        def _should_add(name: str) -> bool:
            return not kw or kw in name.lower()

        def _is_auth_error(e: Exception) -> bool:
            """检查是否是认证错误（401）"""
            if isinstance(e, httpx.HTTPStatusError):
                return e.response.status_code == 401
            if isinstance(e, FeishuAPIError):
                return "401" in str(e) or "Unauthorized" in str(e) or "token" in str(e).lower()
            return False

        # 1. 自己云空间的多维表格
        try:
            bitables = await feishu_client.list_drive_bitables(user_access_token=token)
            for f in bitables:
                name = f.get("name", "")
                if _should_add(name):
                    _add(f.get("token", ""), name, "bitable")
        except Exception as e:
            if _is_auth_error(e):
                raise FeishuAPIError(f"用户 Token 已过期: {e}")
            logger.warning("列出云空间多维表格失败: %s", e)

        # 2. 自己云空间的飞书表格
        try:
            sheets = await feishu_client.list_drive_spreadsheets(user_access_token=token)
            for f in sheets:
                name = f.get("name", "")
                if _should_add(name):
                    _add(f.get("token", ""), name, "spreadsheet")
        except Exception as e:
            if _is_auth_error(e):
                raise FeishuAPIError(f"用户 Token 已过期: {e}")
            logger.warning("列出云空间飞书表格失败: %s", e)

        # 3. 知识空间中的多维表格和飞书表格
        try:
            wiki_nodes = await feishu_client.list_wiki_nodes_by_type(
                {"bitable", "sheet"}, user_access_token=token,
            )
            for node in wiki_nodes:
                obj_type = node.get("obj_type", "")
                t = node.get("obj_token", "")
                space_name = node.get("space_name", "")
                title = node.get("title", "未命名")
                name = f"[{space_name}] {title}" if space_name else title
                if _should_add(name):
                    _add(t, name, doc_type_map.get(obj_type, "bitable"))
        except Exception as e:
            if _is_auth_error(e):
                raise FeishuAPIError(f"用户 Token 已过期: {e}")
            logger.warning("列出知识空间表格失败: %s", e)

        # 4. 搜索 API 补充（发现他人分享的表格）
        try:
            search_kw = keyword if keyword else " "
            files = await feishu_client.search_accessible_docs(
                keyword=search_kw, user_access_token=token,
                doc_types=["bitable", "sheet", "wiki"],
                max_count=200,
            )
            for f in files:
                raw_type = f.get("type", "")
                if raw_type not in TABLE_TYPES:
                    continue
                name = f.get("name", "")
                if _should_add(name):
                    _add(f.get("token", ""), name, doc_type_map.get(raw_type, raw_type))
        except Exception as e:
            if _is_auth_error(e):
                raise FeishuAPIError(f"用户 Token 已过期: {e}")
            logger.warning("搜索补充表格失败: %s", e)

    async def _action(token: str) -> None:
        await _collect_all(token, name_filter=keyword)

    try:
        await _action(user_token)
    except FeishuAPIError:
        user_token = await _refresh_and_retry(current_user, db)
        if not user_token:
            raise HTTPException(401, "飞书授权已过期，请重新登录")
        try:
            await _action(user_token)
        except Exception as e:
            logger.error("刷新后仍失败: %s", e)
            raise HTTPException(500, f"获取飞书表格列表失败: {e}")
    except Exception as e:
        logger.error("发现飞书表格失败: %s", e)
        raise HTTPException(500, f"获取飞书表格列表失败: {e}")

    return results


@router.get("/feishu-discover/wiki-resolve/{node_token}", summary="解析 wiki 节点的实际类型")
async def resolve_wiki_node(
    node_token: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """解析知识空间 wiki 节点的实际类型，返回 obj_token 和 obj_type。"""
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")
    try:
        node = await feishu_client.get_wiki_node_info(node_token, user_access_token=user_token)
    except FeishuAPIError:
        user_token = await _refresh_and_retry(current_user, db)
        if not user_token:
            raise HTTPException(401, "飞书授权已过期，请重新登录")
        node = await feishu_client.get_wiki_node_info(node_token, user_access_token=user_token)

    obj_type = node.get("obj_type", "unknown")
    obj_token = node.get("obj_token", node_token)
    # 映射 sheet → spreadsheet 保持前端一致
    if obj_type == "sheet":
        obj_type = "spreadsheet"
    return {"obj_type": obj_type, "obj_token": obj_token, "title": node.get("title", "")}


@router.get(
    "/feishu-discover/{app_token}/tables",
    response_model=list[BitableTableInfo],
    summary="获取多维表格的数据表列表",
)
async def discover_bitable_tables(
    app_token: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    doc_type: str = Query("bitable", alias="type", description="bitable 或 spreadsheet"),
) -> list[BitableTableInfo]:
    """按需加载指定多维表格/飞书表格下的数据表列表。"""
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    async def _fetch(token: str) -> list[dict]:
        if doc_type == "spreadsheet":
            return await feishu_client.get_spreadsheet_sheets(
                app_token, user_access_token=token
            )
        else:
            return await feishu_client.get_bitable_tables(
                app_token, user_access_token=token
            )

    try:
        tables_raw = await _fetch(user_token)
    except FeishuAPIError:
        user_token = await _refresh_and_retry(current_user, db)
        if not user_token:
            raise HTTPException(401, "飞书授权已过期，请重新登录")
        try:
            tables_raw = await _fetch(user_token)
        except Exception as e:
            raise HTTPException(500, f"获取数据表列表失败: {e}")
    except Exception as e:
        raise HTTPException(500, f"获取数据表列表失败: {e}")

    if doc_type == "spreadsheet":
        return [
            BitableTableInfo(
                table_id=t.get("sheet_id", ""),
                name=t.get("title", "未命名"),
            )
            for t in tables_raw
        ]
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
        if item.asset_type not in ("document", "communication", "structured"):
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


class FeishuSourceFromURLRequest(BaseModel):
    url: str
    asset_type: str = "document"


@router.post("/feishu-source-from-url", response_model=DataSourceOut, summary="从飞书链接创建数据源")
async def add_feishu_source_from_url(
    body: FeishuSourceFromURLRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DataSourceOut:
    """解析飞书链接并自动创建 ETLDataSource 记录。

    支持多维表格直链、Wiki 内嵌多维表格链接。
    如果链接中没有 table_id，自动取第一个子表。
    """
    import re

    if body.asset_type not in ("document", "communication", "structured"):
        raise HTTPException(400, "asset_type 必须是 document / communication / structured")

    url = body.url.strip()

    # 解析 URL
    parsed_type = None
    token = None
    table_id = None

    # 多维表格直链: /base/{app_token}
    m = re.search(r'/base/([A-Za-z0-9_-]+)', url)
    if m:
        parsed_type = "bitable"
        token = m.group(1)
        tm = re.search(r'[?&]table=([A-Za-z0-9_-]+)', url)
        table_id = tm.group(1) if tm else None

    # Wiki 链接: /wiki/{node_token}
    if not parsed_type:
        m = re.search(r'/wiki/([A-Za-z0-9_-]+)', url)
        if m:
            parsed_type = "wiki"
            token = m.group(1)
            tm = re.search(r'[?&]table=([A-Za-z0-9_-]+)', url)
            table_id = tm.group(1) if tm else None

    if not parsed_type or not token:
        raise HTTPException(400, "无法识别的链接格式，请粘贴飞书多维表格的链接")

    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    # Wiki → 解析实际 obj_token
    if parsed_type == "wiki":
        try:
            try:
                node_info = await feishu_client.get_wiki_node_info(
                    token, user_access_token=user_token,
                )
            except Exception:
                node_info = await feishu_client.get_wiki_node_info(token)
            obj_type = node_info.get("obj_type", "")
            obj_token = node_info.get("obj_token", "")
            if obj_type != "bitable":
                raise HTTPException(400, f"该页面类型 {obj_type} 不支持，仅支持多维表格")
            token = obj_token
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"解析 Wiki 链接失败: {e}")

    # 如果没有 table_id，取第一个子表
    if not table_id:
        try:
            tables_raw = await feishu_client.get_bitable_tables(
                token, user_access_token=user_token,
            )
            if not tables_raw:
                raise HTTPException(400, "该多维表格下没有数据表")
            table_id = tables_raw[0].get("table_id", "")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"获取数据表列表失败: {e}")

    # 查重
    existing = await db.execute(
        select(ETLDataSource).where(
            ETLDataSource.app_token == token,
            ETLDataSource.table_id == table_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "该数据源已存在")

    # 获取表名
    table_name = ""
    try:
        tables_raw = await feishu_client.get_bitable_tables(
            token, user_access_token=user_token,
        )
        for t in tables_raw:
            if t.get("table_id") == table_id:
                table_name = t.get("name", "")
                break
    except Exception:
        pass

    ds = ETLDataSource(
        app_token=token,
        table_id=table_id,
        table_name=table_name,
        asset_type=body.asset_type,
        owner_id=current_user.feishu_open_id,
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return DataSourceOut.model_validate(ds)


# ── 云文档/文件导入 ─────────────────────────────────────────

class CloudDocInfo(BaseModel):
    """云文档/文件发现信息。"""
    token: str
    name: str
    doc_type: str  # "docx", "doc", "file"
    modified_time: str | None = None
    already_imported: bool = False


class CloudDocImportRequest(BaseModel):
    """云文档批量导入请求。"""
    items: list[dict]  # [{token, name, type}, ...]


class CloudDocImportResponse(BaseModel):
    """云文档导入结果。"""
    imported: int
    skipped: int
    failed: int


class CloudFolderCreate(BaseModel):
    """云文件夹源创建请求。"""
    folder_token: str
    folder_name: str = ""


class CloudFolderOut(BaseModel):
    """云文件夹源输出。"""
    id: int
    folder_token: str
    folder_name: str
    owner_id: str
    is_enabled: bool
    last_sync_time: datetime | None = None
    last_sync_status: str
    files_synced: int
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.get("/feishu-docs", response_model=list[CloudDocInfo], summary="发现可用的飞书云文档/文件")
async def discover_feishu_docs(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(default="", description="搜索关键词，空则返回近期所有可访问文档"),
) -> list[CloudDocInfo]:
    """搜索当前用户有权限访问的飞书云文档（云盘 + 知识空间 + 他人分享）。"""
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    async def _fetch_docs(token: str) -> list[dict]:
        if q.strip():
            return await feishu_client.search_accessible_docs(
                keyword=q,
                user_access_token=token,
                doc_types=["doc", "docx", "file", "wiki"],
                max_count=100,
            )
        else:
            return await feishu_client.list_drive_documents(user_access_token=token)

    try:
        files = await _fetch_docs(user_token)
    except FeishuAPIError:
        user_token = await _refresh_and_retry(current_user, db)
        if not user_token:
            raise HTTPException(401, "飞书授权已过期，请重新登录")
        try:
            files = await _fetch_docs(user_token)
        except Exception as e:
            logger.error("刷新后仍失败: %s", e)
            raise HTTPException(500, f"获取飞书云文档列表失败: {e}")
    except Exception as e:
        logger.error("发现飞书云文档失败: %s", e)
        raise HTTPException(500, f"获取飞书云文档列表失败: {e}")

    # 查询已导入的文档 token 集合
    result = await db.execute(
        select(Document.feishu_record_id).where(
            Document.owner_id == current_user.feishu_open_id,
            Document.source_type == "cloud",
            Document.feishu_record_id.isnot(None),
        )
    )
    imported_tokens = {row[0] for row in result.all()}

    docs: list[CloudDocInfo] = []
    for f in files:
        token = f.get("token", "")
        docs.append(CloudDocInfo(
            token=token,
            name=f.get("name", "未命名"),
            doc_type=f.get("type", ""),
            modified_time=f.get("modified_time"),
            already_imported=token in imported_tokens,
        ))
    return docs


@router.post("/feishu-docs", summary="批量导入云文档/文件（后台执行）")
async def import_feishu_docs(
    body: CloudDocImportRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """导入选中的飞书云文档和文件 — 提交后立即返回，后台异步执行。"""
    if not body.items:
        raise HTTPException(400, "请选择要导入的文档")

    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    owner_id = current_user.feishu_open_id
    uploader_name = current_user.name
    items = body.items

    # 创建任务记录
    task = ImportTask(
        task_type="cloud_doc",
        status="pending",
        owner_id=owner_id,
        total_count=len(items),
        details={"files": [{"token": i.get("token"), "name": i.get("name")} for i in items[:10]]},
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    task_id = task.id

    async def _bg_import():
        from app.database import async_session
        async with async_session() as session:
            try:
                # 更新状态为 running
                task_in_session = await session.get(ImportTask, task_id)
                if task_in_session:
                    task_in_session.status = "running"
                    task_in_session.started_at = datetime.utcnow()
                    await session.commit()

                # 不限总时长，让后台慢慢跑；单文件超时由 batch_import 内部控制（90s/文件）
                result = await cloud_doc_import_service.batch_import(
                    file_infos=items,
                    owner_id=owner_id,
                    db=session,
                    user_access_token=user_token,
                    uploader_name=uploader_name,
                )

                # 检查是否已被用户取消
                task_in_session = await session.get(ImportTask, task_id)
                if task_in_session and task_in_session.status == "cancelled":
                    logger.info("导入任务已被用户取消: task_id=%d", task_id)
                    return

                # 更新任务结果
                if task_in_session:
                    task_in_session.status = "completed"
                    task_in_session.imported_count = result.imported
                    task_in_session.skipped_count = result.skipped
                    task_in_session.failed_count = result.failed
                    task_in_session.completed_at = datetime.utcnow()
                    await session.commit()

                logger.info(
                    "后台云文档导入完成: imported=%d, skipped=%d, failed=%d",
                    result.imported, result.skipped, result.failed,
                )
            except Exception as e:
                logger.error("后台云文档导入异常: %s", e)
                try:
                    task_in_session = await session.get(ImportTask, task_id)
                    if task_in_session and task_in_session.status not in ("cancelled", "timeout"):
                        task_in_session.status = "failed"
                        task_in_session.error_message = str(e)[:500]
                        task_in_session.completed_at = datetime.utcnow()
                        await session.commit()
                except Exception:
                    pass

    asyncio.create_task(_bg_import())
    return {"message": f"已提交 {len(items)} 个文档到后台导入", "count": len(items), "task_id": task_id}


class CommDocImportRequest(BaseModel):
    """沟通资产云文档导入请求。"""
    items: list[dict]  # [{token, name, type}, ...]


@router.post("/feishu-docs/communication", summary="批量导入云文档为沟通资产（后台执行）")
async def import_feishu_docs_as_communication(
    body: CommDocImportRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """将会议纪要、文字记录等云文档导入为沟通资产，使用 LLM 智能提取字段。后台异步执行。"""
    if not body.items:
        raise HTTPException(400, "请选择要导入的文档")

    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    owner_id = current_user.feishu_open_id
    uploader_name = current_user.name
    items = body.items

    # 创建任务记录
    task = ImportTask(
        task_type="communication",
        status="pending",
        owner_id=owner_id,
        total_count=len(items),
        details={"files": [{"token": i.get("token"), "name": i.get("name")} for i in items[:10]]},
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    task_id = task.id

    async def _bg_import():
        from app.database import async_session
        async with async_session() as session:
            try:
                # 更新状态为 running
                task_in_session = await session.get(ImportTask, task_id)
                if task_in_session:
                    task_in_session.status = "running"
                    task_in_session.started_at = datetime.utcnow()
                    await session.commit()

                # 不限总时长，让后台慢慢跑；单文件超时由 batch_import_as_communication 内部控制（90s/文件）
                result = await cloud_doc_import_service.batch_import_as_communication(
                    file_infos=items,
                    owner_id=owner_id,
                    db=session,
                    user_access_token=user_token,
                    uploader_name=uploader_name,
                )

                # 检查是否已被用户取消
                task_in_session = await session.get(ImportTask, task_id)
                if task_in_session and task_in_session.status == "cancelled":
                    logger.info("沟通资产导入任务已被用户取消: task_id=%d", task_id)
                    return

                # 更新任务结果
                if task_in_session:
                    task_in_session.status = "completed"
                    task_in_session.imported_count = result.imported
                    task_in_session.skipped_count = result.skipped
                    task_in_session.failed_count = result.failed
                    task_in_session.completed_at = datetime.utcnow()
                    await session.commit()

                logger.info(
                    "后台沟通资产导入完成: imported=%d, skipped=%d, failed=%d",
                    result.imported, result.skipped, result.failed,
                )
            except Exception as e:
                logger.error("后台沟通资产导入异常: %s", e)
                try:
                    task_in_session = await session.get(ImportTask, task_id)
                    if task_in_session and task_in_session.status not in ("cancelled", "timeout"):
                        task_in_session.status = "failed"
                        task_in_session.error_message = str(e)[:500]
                        task_in_session.completed_at = datetime.utcnow()
                        await session.commit()
                except Exception:
                    pass

    asyncio.create_task(_bg_import())
    return {"message": f"已提交 {len(items)} 个文档到后台导入为沟通资产", "count": len(items), "task_id": task_id}


@router.post(
    "/feishu-docs/{document_token}/reimport",
    summary="重新导入指定云文档/文件",
)
async def reimport_feishu_doc(
    document_token: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """强制重新导入指定的云文档。"""
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    # 查找已有记录以确定文件类型
    existing = await db.execute(
        select(Document).where(
            Document.feishu_record_id == document_token,
            Document.owner_id == current_user.feishu_open_id,
        )
    )
    doc = existing.scalar_one_or_none()
    file_type = doc.file_type if doc else "docx"

    if file_type in ("docx", "doc"):
        result_doc, status = await cloud_doc_import_service.import_cloud_doc(
            document_token, current_user.feishu_open_id, db,
            user_token, current_user.name, force=True,
        )
    else:
        # 文件类型需要 name，从现有记录获取
        file_name = doc.title if doc else "unknown"
        result_doc, status = await cloud_doc_import_service.import_cloud_file(
            document_token, file_name, current_user.feishu_open_id, db,
            user_token, current_user.name, force=True,
        )

    if status == "failed" or not result_doc:
        raise HTTPException(500, "重新导入失败")

    return {"message": "重新导入成功", "doc_id": result_doc.id}


# ── 云文件夹同步 ─────────────────────────────────────────


@router.get("/cloud-folders/discover", summary="自动发现用户的飞书文件夹")
async def discover_user_folders(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """列出用户飞书云空间根目录下的所有文件夹，用于快速添加同步源。"""
    user_token = getattr(current_user, "feishu_access_token", None)
    try:
        folders = await feishu_client.list_root_folders(user_access_token=user_token)
        return folders
    except FeishuAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception:
        raise HTTPException(status_code=502, detail="获取飞书文件夹列表失败")


@router.get("/cloud-folders", response_model=list[CloudFolderOut], summary="查看我的云文件夹源")
async def list_cloud_folders(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[CloudFolderOut]:
    """列出当前用户配置的云文件夹数据源。"""
    result = await db.execute(
        select(CloudFolderSource)
        .where(CloudFolderSource.owner_id == current_user.feishu_open_id)
        .order_by(CloudFolderSource.id)
    )
    return [CloudFolderOut.model_validate(s) for s in result.scalars().all()]


@router.post("/cloud-folders", response_model=CloudFolderOut, summary="添加云文件夹源")
async def add_cloud_folder(
    body: CloudFolderCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CloudFolderOut:
    """添加飞书云文件夹作为数据源，支持自动同步。"""
    # 去重检查
    existing = await db.execute(
        select(CloudFolderSource).where(
            CloudFolderSource.folder_token == body.folder_token,
            CloudFolderSource.owner_id == current_user.feishu_open_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "该文件夹已配置")

    folder = CloudFolderSource(
        folder_token=body.folder_token,
        folder_name=body.folder_name,
        owner_id=current_user.feishu_open_id,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return CloudFolderOut.model_validate(folder)


@router.delete("/cloud-folders/{folder_id}", summary="删除云文件夹源")
async def delete_cloud_folder(
    folder_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    folder = await db.get(CloudFolderSource, folder_id)
    if not folder:
        raise HTTPException(404, "文件夹源不存在")
    if folder.owner_id != current_user.feishu_open_id and current_user.role != "admin":
        raise HTTPException(403, "无权删除此文件夹源")

    await db.delete(folder)
    await db.commit()
    return {"message": "已删除"}


@router.post("/cloud-folders/sync", summary="触发云文件夹同步")
async def trigger_cloud_folder_sync(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """手动触发当前用户所有启用的云文件夹同步。"""
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    result = await db.execute(
        select(CloudFolderSource).where(
            CloudFolderSource.owner_id == current_user.feishu_open_id,
            CloudFolderSource.is_enabled == True,  # noqa: E712
        )
    )
    folders = result.scalars().all()
    if not folders:
        raise HTTPException(400, "没有已启用的云文件夹源")

    # 在后台异步执行同步
    async def _sync_all():
        from app.database import async_session
        async with async_session() as session:
            for folder in folders:
                try:
                    # 更新状态为 running
                    folder_in_session = await session.get(CloudFolderSource, folder.id)
                    if not folder_in_session:
                        continue
                    folder_in_session.last_sync_status = "running"
                    await session.commit()

                    sync_result = await cloud_doc_import_service.sync_folder(
                        folder.folder_token,
                        folder.owner_id,
                        session,
                        user_token,
                        current_user.name,
                    )

                    folder_in_session.last_sync_status = "success"
                    folder_in_session.last_sync_time = datetime.utcnow()
                    folder_in_session.files_synced = sync_result.imported + sync_result.skipped
                    folder_in_session.error_message = None
                    await session.commit()

                    logger.info(
                        "文件夹 %s 同步完成: imported=%d, skipped=%d, failed=%d",
                        folder.folder_name, sync_result.imported,
                        sync_result.skipped, sync_result.failed,
                    )
                except Exception as e:
                    logger.error("文件夹 %s 同步失败: %s", folder.folder_name, e)
                    try:
                        folder_in_session = await session.get(CloudFolderSource, folder.id)
                        if folder_in_session:
                            folder_in_session.last_sync_status = "failed"
                            folder_in_session.error_message = str(e)[:500]
                            await session.commit()
                    except Exception:
                        pass

    asyncio.create_task(_sync_all())
    return {"message": "文件夹同步已触发", "folders_count": len(folders)}


# ── 导入任务状态 ─────────────────────────────────────────

class ImportTaskOut(BaseModel):
    """导入任务输出。"""
    id: int
    task_type: str
    status: str
    total_count: int
    imported_count: int
    skipped_count: int
    failed_count: int
    error_message: str | None = None
    details: dict
    started_at: UTCDatetimeOpt = None
    completed_at: UTCDatetimeOpt = None
    created_at: UTCDatetime

    model_config = {"from_attributes": True}


@router.get("/tasks", response_model=list[ImportTaskOut], summary="查询我的导入任务")
async def list_import_tasks(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(default=20, le=100),
) -> list[ImportTaskOut]:
    """获取当前用户的导入任务列表，按创建时间倒序。"""
    result = await db.execute(
        select(ImportTask)
        .where(ImportTask.owner_id == current_user.feishu_open_id)
        .order_by(ImportTask.id.desc())
        .limit(limit)
    )
    tasks = result.scalars().all()
    return [ImportTaskOut.model_validate(t) for t in tasks]


@router.get("/tasks/{task_id}", response_model=ImportTaskOut, summary="查询单个导入任务")
async def get_import_task(
    task_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ImportTaskOut:
    """获取指定导入任务的详情。"""
    task = await db.get(ImportTask, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    if task.owner_id != current_user.feishu_open_id and current_user.role != "admin":
        raise HTTPException(403, "无权查看此任务")
    return ImportTaskOut.model_validate(task)


@router.post("/tasks/{task_id}/cancel", summary="取消导入任务")
async def cancel_import_task(
    task_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """取消进行中的导入任务。"""
    task = await db.get(ImportTask, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    if task.owner_id != current_user.feishu_open_id and current_user.role != "admin":
        raise HTTPException(403, "无权取消此任务")
    if task.status not in ("pending", "running"):
        raise HTTPException(400, "只能取消等待中或运行中的任务")

    task.status = "cancelled"
    task.error_message = "用户手动取消"
    task.completed_at = datetime.utcnow()
    await db.commit()
    return {"message": "任务已取消"}


@router.delete("/tasks/{task_id}", summary="删除导入任务记录")
async def delete_import_task(
    task_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """删除已完成/失败/超时/取消的导入任务记录。"""
    task = await db.get(ImportTask, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    if task.owner_id != current_user.feishu_open_id and current_user.role != "admin":
        raise HTTPException(403, "无权删除此任务")
    if task.status in ("pending", "running"):
        raise HTTPException(400, "不能删除进行中的任务，请先取消")

    await db.delete(task)
    await db.commit()
    return {"message": "任务记录已删除"}
