"""个人设置 API。"""

import asyncio
import logging
from typing import Annotated

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_user_feishu_token, refresh_user_feishu_token
from app.models.asset import CloudFolderSource, ETLDataSource
from app.models.department import Department, UserDepartment, UserDeptSharing, UserVisibilityOverride
from app.models.keyword_sync_rule import KeywordSyncRule
from app.models.notification_pref import UserNotificationPref
from app.models.user import User
from app.schemas.etl import CloudFolderCreate, CloudFolderOut, CloudFolderToggle, DataSourceCreate, DataSourceOut, DataSourceToggle
from app.schemas.settings import (
    KeywordFastImportRequest,
    KeywordPreviewDoc,
    KeywordPreviewRequest,
    KeywordSyncRuleCreate,
    KeywordSyncRuleOut,
    KeywordSyncRuleToggle,
    KeywordSyncRuleUpdateTags,
    NotificationPrefOut,
    NotificationPrefUpdate,
    ProfileOut,
    SharedToMeDepartment,
    SharedToMeOut,
    SharedToMeUser,
    SharingOut,
    SharingUpdate,
)

router = APIRouter(prefix="/api/settings", tags=["个人设置"])


# ── 个人信息 ──

@router.get("/profile", response_model=ProfileOut)
async def get_profile(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # 查询用户所属部门
    result = await db.execute(
        select(Department.name)
        .join(UserDepartment, UserDepartment.department_id == Department.id)
        .where(UserDepartment.user_id == user.id)
    )
    dept_names = [row[0] for row in result.fetchall()]
    return ProfileOut(
        id=user.id,
        name=user.name,
        email=user.email,
        avatar_url=user.avatar_url,
        role=user.role,
        departments=dept_names,
    )


# ── 数据分享 ──

@router.get("/sharing", response_model=SharingOut)
async def get_sharing(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # 用户级分享
    r1 = await db.execute(
        select(UserVisibilityOverride.target_user_id)
        .where(UserVisibilityOverride.user_id == user.id)
    )
    target_user_ids = [row[0] for row in r1.fetchall()]

    # 部门级分享
    r2 = await db.execute(
        select(UserDeptSharing.department_id)
        .where(UserDeptSharing.user_id == user.id)
    )
    target_department_ids = [row[0] for row in r2.fetchall()]

    return SharingOut(
        target_user_ids=target_user_ids,
        target_department_ids=target_department_ids,
    )


@router.put("/sharing", response_model=SharingOut)
async def update_sharing(
    body: SharingUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # 清除旧的用户级分享，重新插入
    await db.execute(
        delete(UserVisibilityOverride).where(UserVisibilityOverride.user_id == user.id)
    )
    for target_uid in body.target_user_ids:
        db.add(UserVisibilityOverride(user_id=user.id, target_user_id=target_uid))

    # 清除旧的部门级分享，重新插入
    await db.execute(
        delete(UserDeptSharing).where(UserDeptSharing.user_id == user.id)
    )
    for dept_id in body.target_department_ids:
        db.add(UserDeptSharing(user_id=user.id, department_id=dept_id))

    await db.commit()
    return SharingOut(
        target_user_ids=body.target_user_ids,
        target_department_ids=body.target_department_ids,
    )


@router.get("/shared-to-me", response_model=SharedToMeOut)
async def get_shared_to_me(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """查询谁把数据分享给了我（只读）。"""
    # 1. 直接分享给我的人
    r1 = await db.execute(
        select(User.id, User.name)
        .join(UserVisibilityOverride, UserVisibilityOverride.user_id == User.id)
        .where(UserVisibilityOverride.target_user_id == user.id)
    )
    shared_by_users = [
        SharedToMeUser(user_id=row[0], user_name=row[1])
        for row in r1.fetchall()
    ]

    # 2. 查我所在的部门
    my_dept_q = await db.execute(
        select(UserDepartment.department_id).where(UserDepartment.user_id == user.id)
    )
    my_dept_ids = [row[0] for row in my_dept_q.fetchall()]

    # 3. 通过我所在部门分享给我的人（按部门分组）
    shared_by_departments: list[SharedToMeDepartment] = []
    if my_dept_ids:
        for dept_id in my_dept_ids:
            dept_q = await db.execute(
                select(Department.name).where(Department.id == dept_id)
            )
            dept_name = dept_q.scalar_one_or_none() or f"部门#{dept_id}"

            r2 = await db.execute(
                select(User.id, User.name)
                .join(UserDeptSharing, UserDeptSharing.user_id == User.id)
                .where(UserDeptSharing.department_id == dept_id)
            )
            dept_users = [
                SharedToMeUser(user_id=row[0], user_name=row[1])
                for row in r2.fetchall()
            ]
            if dept_users:
                shared_by_departments.append(
                    SharedToMeDepartment(
                        department_id=dept_id,
                        department_name=dept_name,
                        users=dept_users,
                    )
                )

    return SharedToMeOut(
        shared_by_users=shared_by_users,
        shared_by_departments=shared_by_departments,
    )


# ── 我的数据源 ──

@router.get("/my-sources", response_model=list[DataSourceOut])
async def list_my_sources(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ETLDataSource).where(ETLDataSource.owner_id == user.feishu_open_id)
    )
    return result.scalars().all()


@router.post("/my-sources", response_model=DataSourceOut, status_code=201)
async def add_my_source(
    body: DataSourceCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    ds = ETLDataSource(
        app_token=body.app_token,
        table_id=body.table_id,
        table_name=body.table_name,
        asset_type=body.asset_type,
        default_tag_ids=body.default_tag_ids,
        include_shared=body.include_shared,
        owner_id=user.feishu_open_id,
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return ds


@router.patch("/my-sources/{source_id}", response_model=DataSourceOut)
async def toggle_my_source(
    source_id: int,
    body: DataSourceToggle,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ETLDataSource).where(
            ETLDataSource.id == source_id,
            ETLDataSource.owner_id == user.feishu_open_id,
        )
    )
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据源不存在")
    ds.is_enabled = body.is_enabled
    await db.commit()
    await db.refresh(ds)
    return ds


@router.delete("/my-sources/{source_id}", status_code=204)
async def delete_my_source(
    source_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ETLDataSource).where(
            ETLDataSource.id == source_id,
            ETLDataSource.owner_id == user.feishu_open_id,
        )
    )
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据源不存在")
    await db.delete(ds)
    await db.commit()


# ── 关键词同步规则 ──

@router.get("/keyword-rules", response_model=list[KeywordSyncRuleOut])
async def list_keyword_rules(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(KeywordSyncRule)
        .where(KeywordSyncRule.owner_id == user.feishu_open_id)
        .order_by(KeywordSyncRule.created_at.desc())
    )
    return result.scalars().all()


@router.post("/keyword-rules", response_model=KeywordSyncRuleOut, status_code=201)
async def create_keyword_rule(
    body: KeywordSyncRuleCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    keyword = body.keyword.strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="关键词不能为空")
    # 检查重复
    existing = await db.execute(
        select(KeywordSyncRule).where(
            KeywordSyncRule.owner_id == user.feishu_open_id,
            KeywordSyncRule.keyword == keyword,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="该关键词已存在")
    rule = KeywordSyncRule(
        owner_id=user.feishu_open_id,
        keyword=keyword,
        include_shared=body.include_shared,
        default_tag_ids=body.default_tag_ids,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/keyword-rules/{rule_id}", response_model=KeywordSyncRuleOut)
async def toggle_keyword_rule(
    rule_id: int,
    body: KeywordSyncRuleToggle,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(KeywordSyncRule).where(
            KeywordSyncRule.id == rule_id,
            KeywordSyncRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    rule.is_enabled = body.is_enabled
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/keyword-rules/{rule_id}", status_code=204)
async def delete_keyword_rule(
    rule_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(KeywordSyncRule).where(
            KeywordSyncRule.id == rule_id,
            KeywordSyncRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    await db.delete(rule)
    await db.commit()


@router.patch("/keyword-rules/{rule_id}/scope", response_model=KeywordSyncRuleOut)
async def update_keyword_rule_scope(
    rule_id: int,
    body: KeywordSyncRuleToggle,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(KeywordSyncRule).where(
            KeywordSyncRule.id == rule_id,
            KeywordSyncRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    rule.include_shared = body.is_enabled
    await db.commit()
    await db.refresh(rule)
    return rule


@router.post("/keyword-rules/preview", response_model=list[KeywordPreviewDoc])
async def preview_keyword_docs(
    body: KeywordPreviewRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """搜索关键词匹配的云文档列表（不导入），用于用户确认前预览。"""
    keyword = body.keyword.strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="关键词不能为空")

    user_token = await get_user_feishu_token(user, db)

    from app.services.feishu import FeishuAPIError, feishu_client
    try:
        docs = await feishu_client.search_accessible_docs(
            keyword=keyword,
            user_access_token=user_token,
            doc_types=["doc", "docx", "file", "wiki"],
            max_count=200,
        )
    except FeishuAPIError:
        # Token 过期，尝试刷新后重试
        user_token = await refresh_user_feishu_token(user, db)
        try:
            docs = await feishu_client.search_accessible_docs(
                keyword=keyword,
                user_access_token=user_token,
                doc_types=["doc", "docx", "file", "wiki"],
                max_count=200,
            )
        except FeishuAPIError as e:
            raise HTTPException(status_code=502, detail=f"飞书搜索失败: {e}")

    logger.info("关键词预览「%s」搜索到 %d 个文档", keyword, len(docs))

    # 批量获取文档元数据（create_time, url, owner_name）
    valid_docs = [d for d in docs if d.get("token")]
    meta_map: dict[str, dict] = {}
    if valid_docs:
        # wiki 类型文档需要先解析 obj_token，batch_get_doc_meta 不支持 doc_type="wiki"
        wiki_obj_map: dict[str, dict] = {}
        wiki_docs_no_owner = [d for d in valid_docs if d.get("type") == "wiki" and not d.get("owner_id")]
        if wiki_docs_no_owner:
            import asyncio
            async def _resolve_wiki(tok: str):
                try:
                    node = await feishu_client.get_wiki_node_info(tok, user_access_token=user_token)
                    return tok, node.get("obj_token", ""), node.get("obj_type", "docx")
                except Exception:
                    return tok, "", ""
            resolved = await asyncio.gather(*[_resolve_wiki(d["token"]) for d in wiki_docs_no_owner[:30]])
            for wt, obj_tok, obj_typ in resolved:
                if obj_tok:
                    wiki_obj_map[wt] = {"obj_token": obj_tok, "obj_type": obj_typ}

        try:
            meta_docs = []
            obj_to_wiki: dict[str, str] = {}
            for d in valid_docs:
                tok = d["token"]
                if tok in wiki_obj_map:
                    obj_tok = wiki_obj_map[tok]["obj_token"]
                    meta_docs.append({"token": obj_tok, "type": wiki_obj_map[tok]["obj_type"]})
                    obj_to_wiki[obj_tok] = tok
                else:
                    meta_docs.append({"token": tok, "type": d.get("type", "docx")})
            raw_meta = await feishu_client.batch_get_doc_meta(
                docs=meta_docs,
                user_access_token=user_token,
            )
            # wiki obj_token 结果映射回原始 wiki token
            for obj_tok, wiki_tok in obj_to_wiki.items():
                if obj_tok in raw_meta:
                    meta_map[wiki_tok] = raw_meta[obj_tok]
            for tok, meta in raw_meta.items():
                if tok not in obj_to_wiki:
                    meta_map[tok] = meta
        except Exception as e:
            logger.warning("batch_get_doc_meta 失败: %s", e)

    from datetime import datetime, timezone

    def _ts_to_iso(ts: str | int | None) -> str | None:
        if not ts:
            return None
        try:
            return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
        except (ValueError, TypeError, OSError):
            return None

    results = []
    for d in valid_docs:
        tok = d["token"]
        meta = meta_map.get(tok, {})
        ct = _ts_to_iso(meta.get("create_time") or d.get("create_time"))
        results.append(KeywordPreviewDoc(
            token=tok,
            name=d.get("name", "未命名"),
            doc_type=d.get("type", "docx"),
            url=meta.get("url") or d.get("url", ""),
            owner_id=d.get("owner_id", ""),
            owner_name=meta.get("owner_name") or d.get("owner_name", ""),
            create_time=ct,
        ))
    logger.info("预览结果: %d 篇, meta命中=%d, create_time样例=%s, url样例=%s",
                len(results), len(meta_map),
                results[0].create_time if results else "N/A",
                results[0].url[:50] if results and results[0].url else "N/A")
    return results


@router.post("/keyword-rules/fast-import")
async def fast_import_keyword_docs(
    body: KeywordFastImportRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """快速导入选定的云文档（仅保存元数据，内容解析在后台进行）。"""
    from app.services.cloud_doc_import import cloud_doc_import_service
    imported = skipped = failed = 0
    for doc in body.docs:
        file_info = {
            "token": doc.token,
            "name": doc.name,
            "type": doc.doc_type,
            "url": doc.url,
            "owner_id": doc.owner_id,
            "owner_name": doc.owner_name,
        }
        _, status = await cloud_doc_import_service.fast_import_item(
            file_info=file_info,
            owner_id=user.feishu_open_id,
            db=db,
            tag_ids=body.tag_ids or None,
        )
        if status == "imported":
            imported += 1
        elif status == "skipped":
            skipped += 1
        else:
            failed += 1

    return {"imported": imported, "skipped": skipped, "failed": failed,
            "message": f"已导入 {imported} 篇，跳过 {skipped} 篇，内容解析将在后台完成"}


@router.post("/keyword-rules/{rule_id}/sync")
async def trigger_single_rule_sync(
    rule_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """手动触发单条关键词规则的同步（同步执行，返回结果）。

    使用飞书搜索 API 搜索用户可访问的全部文档（含他人分享），
    匹配关键词后导入到文档库。
    """
    result = await db.execute(
        select(KeywordSyncRule).where(
            KeywordSyncRule.id == rule_id,
            KeywordSyncRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")

    user_token = await get_user_feishu_token(user, db)

    from app.services.keyword_sync import sync_single_rule
    sync_result = await sync_single_rule(
        rule, db, user_token, asset_owner_name=user.name,
    )
    return {
        "keyword": sync_result.keyword,
        "matched": sync_result.matched,
        "imported": sync_result.imported,
        "skipped": sync_result.skipped,
        "failed": sync_result.failed,
    }


@router.patch("/keyword-rules/{rule_id}/tags", response_model=KeywordSyncRuleOut)
async def update_keyword_rule_tags(
    rule_id: int,
    body: KeywordSyncRuleUpdateTags,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """更新关键词规则的默认标签列表。"""
    result = await db.execute(
        select(KeywordSyncRule).where(
            KeywordSyncRule.id == rule_id,
            KeywordSyncRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    rule.default_tag_ids = body.default_tag_ids
    await db.commit()
    await db.refresh(rule)
    return rule


# ── 我的云文件夹 ──

@router.get("/my-folders", response_model=list[CloudFolderOut])
async def list_my_folders(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(CloudFolderSource)
        .where(CloudFolderSource.owner_id == user.feishu_open_id)
        .order_by(CloudFolderSource.created_at.desc())
    )
    return result.scalars().all()


@router.post("/my-folders", response_model=CloudFolderOut, status_code=201)
async def add_my_folder(
    body: CloudFolderCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    folder_token = body.folder_token.strip()
    if not folder_token:
        raise HTTPException(status_code=400, detail="文件夹 Token 不能为空")
    # 检查重复
    existing = await db.execute(
        select(CloudFolderSource).where(
            CloudFolderSource.folder_token == folder_token,
            CloudFolderSource.owner_id == user.feishu_open_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="该文件夹已添加")
    folder = CloudFolderSource(
        folder_token=folder_token,
        folder_name=body.folder_name,
        include_shared=body.include_shared,
        owner_id=user.feishu_open_id,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


@router.patch("/my-folders/{folder_id}", response_model=CloudFolderOut)
async def toggle_my_folder(
    folder_id: int,
    body: CloudFolderToggle,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(CloudFolderSource).where(
            CloudFolderSource.id == folder_id,
            CloudFolderSource.owner_id == user.feishu_open_id,
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    folder.is_enabled = body.is_enabled
    await db.commit()
    await db.refresh(folder)
    return folder


@router.delete("/my-folders/{folder_id}", status_code=204)
async def delete_my_folder(
    folder_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(CloudFolderSource).where(
            CloudFolderSource.id == folder_id,
            CloudFolderSource.owner_id == user.feishu_open_id,
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    await db.delete(folder)
    await db.commit()


# ── 通知偏好 ──

@router.get("/notifications", response_model=NotificationPrefOut)
async def get_notifications(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(UserNotificationPref).where(UserNotificationPref.owner_id == user.feishu_open_id)
    )
    pref = result.scalar_one_or_none()
    if not pref:
        # 首次访问，创建默认偏好
        pref = UserNotificationPref(owner_id=user.feishu_open_id)
        db.add(pref)
        await db.commit()
        await db.refresh(pref)
    return pref


@router.put("/notifications", response_model=NotificationPrefOut)
async def update_notifications(
    body: NotificationPrefUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(UserNotificationPref).where(UserNotificationPref.owner_id == user.feishu_open_id)
    )
    pref = result.scalar_one_or_none()
    if not pref:
        pref = UserNotificationPref(owner_id=user.feishu_open_id)
        db.add(pref)
        await db.flush()

    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(pref, k, v)

    await db.commit()
    await db.refresh(pref)
    return pref
