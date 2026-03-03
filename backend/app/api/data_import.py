"""用户级数据导入接口 — 用户自行添加飞书数据源并触发同步。"""

import asyncio
import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.asset import ETLDataSource, ETLSyncState, CloudFolderSource
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

    from app.worker.tasks import etl_sync_single_source
    asyncio.create_task(etl_sync_single_source(ds.app_token, ds.table_id, ds.owner_id, ds.asset_type))
    return {"message": "同步任务已触发", "source_id": source_id}


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
    seen_tokens: set[str] = set()
    for f in bitable_files:
        t = f.get("token", "")
        if t and t not in seen_tokens:
            seen_tokens.add(t)
            results.append(BitableAppInfo(
                app_token=t,
                app_name=f.get("name", "未命名"),
                tables=[],
            ))

    # 同时搜索知识空间（Wiki）中的多维表格
    try:
        wiki_nodes = await feishu_client.list_wiki_nodes_by_type(
            {"bitable"},
            user_access_token=user_token,
        )
        for node in wiki_nodes:
            t = node.get("obj_token", "")
            if t and t not in seen_tokens:
                seen_tokens.add(t)
                space_name = node.get("space_name", "")
                title = node.get("title", "未命名")
                name = f"[{space_name}] {title}" if space_name else title
                results.append(BitableAppInfo(
                    app_token=t,
                    app_name=name,
                    tables=[],
                ))
    except Exception as e:
        logger.warning("获取知识空间多维表格失败: %s", e)

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

    if body.asset_type not in ("document", "meeting", "chat_message"):
        raise HTTPException(400, "asset_type 必须是 document / meeting / chat_message")

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
) -> list[CloudDocInfo]:
    """列出当前用户有权限访问的飞书云文档和文件。"""
    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    try:
        files = await feishu_client.list_drive_documents(user_access_token=user_token)
    except FeishuAPIError:
        user_token = await _refresh_and_retry(current_user, db)
        if not user_token:
            raise HTTPException(401, "飞书授权已过期，请重新登录")
        try:
            files = await feishu_client.list_drive_documents(user_access_token=user_token)
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


@router.post("/feishu-docs", response_model=CloudDocImportResponse, summary="批量导入云文档/文件")
async def import_feishu_docs(
    body: CloudDocImportRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CloudDocImportResponse:
    """导入选中的飞书云文档和文件。"""
    if not body.items:
        raise HTTPException(400, "请选择要导入的文档")

    user_token = await _get_user_token(current_user, db)
    if not user_token:
        raise HTTPException(401, "飞书授权已失效，请重新登录")

    result = await cloud_doc_import_service.batch_import(
        file_infos=body.items,
        owner_id=current_user.feishu_open_id,
        db=db,
        user_access_token=user_token,
        uploader_name=current_user.name,
    )
    return CloudDocImportResponse(
        imported=result.imported,
        skipped=result.skipped,
        failed=result.failed,
    )


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
