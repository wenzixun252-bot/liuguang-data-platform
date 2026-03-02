"""权限管理接口。"""

import logging
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, is_super_admin, require_role
from app.models.department import (
    Department, UserDepartment, UserDeptSharing, UserVisibilityOverride,
)
from app.models.user import User
from app.schemas.department import (
    DepartmentNode,
    DeptBrief,
    SetSharingRequest,
    UserDepartmentOut,
    UserPermissionOut,
    VisibleUserItem,
)
from app.services.department_sync import sync_departments, sync_user_departments
from app.services.feishu import FeishuAPIError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/departments", tags=["权限管理"])


@router.post("/sync", summary="同步飞书部门数据（管理员）")
async def trigger_department_sync(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """从飞书拉取部门树和用户部门关系（含自动创建用户）。"""
    try:
        dept_count = await sync_departments(db)
        user_dept_count = await sync_user_departments(db)
    except FeishuAPIError as e:
        error_msg = str(e)
        logger.error("部门同步失败(FeishuAPIError): %s", error_msg)
        raise HTTPException(
            status_code=502,
            detail=(
                "飞书 API 调用失败，请检查应用权限配置。"
                "需要的权限：contact:department.base:readonly、contact:user.base:readonly。"
                f"原始错误：{error_msg}"
            ),
        )
    except Exception as e:
        error_msg = str(e)
        logger.error("部门同步失败(Exception): %s", error_msg, exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=f"部门同步失败：{error_msg}",
        )
    return {
        "message": "部门同步完成",
        "departments_synced": dept_count,
        "user_relations_synced": user_dept_count,
    }


@router.get("/tree", response_model=list[DepartmentNode], summary="获取部门树")
async def get_department_tree(
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DepartmentNode]:
    """返回完整的部门树结构。"""
    result = await db.execute(select(Department).order_by(Department.order_val))
    all_depts = result.scalars().all()

    dept_map: dict[int, DepartmentNode] = {}
    for d in all_depts:
        dept_map[d.id] = DepartmentNode(
            id=d.id,
            feishu_department_id=d.feishu_department_id,
            name=d.name,
            parent_id=d.parent_id,
            children=[],
        )

    roots: list[DepartmentNode] = []
    for node in dept_map.values():
        if node.parent_id and node.parent_id in dept_map:
            dept_map[node.parent_id].children.append(node)
        else:
            roots.append(node)

    return roots


@router.get("/users", response_model=list[UserDepartmentOut], summary="获取部门用户列表")
async def list_department_users(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UserDepartmentOut]:
    """获取所有用户的部门关系。"""
    result = await db.execute(
        select(UserDepartment, User, Department)
        .join(User, UserDepartment.user_id == User.id)
        .join(Department, UserDepartment.department_id == Department.id)
        .order_by(Department.name, User.name)
    )
    rows = result.all()

    return [
        UserDepartmentOut(
            id=ud.id,
            user_id=ud.user_id,
            user_name=user.name,
            feishu_open_id=user.feishu_open_id,
            department_id=ud.department_id,
            department_name=dept.name,
            is_manager=ud.is_manager,
            role=user.role,
        )
        for ud, user, dept in rows
    ]


@router.patch("/users/{user_id}/role", summary="设置用户角色")
async def set_user_role(
    user_id: int,
    role: str,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """设置用户角色: admin / employee。超管不可被降级。"""
    if role not in ("admin", "employee"):
        raise HTTPException(400, "角色只能为 admin 或 employee")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "用户不存在")

    if is_super_admin(user) and role != "admin":
        raise HTTPException(403, "系统超管不可被降级")

    user.role = role
    await db.commit()
    return {"message": f"用户 {user.name} 角色已设为 {role}"}


# ── 权限列表（所有人可看） ──

@router.get("/users/permissions", response_model=list[UserPermissionOut], summary="获取用户权限列表")
async def list_user_permissions(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UserPermissionOut]:
    """返回所有用户的权限信息。所有人可调用。"""
    # 1. 查询所有用户部门关系
    result = await db.execute(
        select(UserDepartment, User, Department)
        .join(User, UserDepartment.user_id == User.id)
        .join(Department, UserDepartment.department_id == Department.id)
        .order_by(User.name)
    )
    rows = result.all()

    all_users_result = await db.execute(select(User))
    all_users_map: dict[int, User] = {u.id: u for u in all_users_result.scalars().all()}

    dept_result = await db.execute(select(Department))
    all_depts_map: dict[int, Department] = {d.id: d for d in dept_result.scalars().all()}

    # 按 user_id 聚合
    user_map: dict[int, dict] = {}
    for ud, user, dept in rows:
        if user.id not in user_map:
            user_map[user.id] = {
                "user_id": user.id,
                "user_name": user.name,
                "feishu_open_id": user.feishu_open_id,
                "role": user.role,
                "dept_list": [],
                "is_manager": False,
            }
        entry = user_map[user.id]
        if not any(d.department_id == dept.id for d in entry["dept_list"]):
            entry["dept_list"].append(DeptBrief(department_id=dept.id, department_name=dept.name))
        if ud.is_manager:
            entry["is_manager"] = True

    # 2. 查询所有用户级分享 (user_id=分享者, target_user_id=被授权者)
    user_share_map: dict[int, list[int]] = defaultdict(list)
    try:
        async with db.begin_nested():
            r = await db.execute(select(UserVisibilityOverride))
            for ov in r.scalars().all():
                user_share_map[ov.user_id].append(ov.target_user_id)
    except Exception:
        logger.warning("user_visibility_overrides 查询失败")

    # 3. 查询所有部门级分享 (user_id=分享者, department_id=目标部门)
    dept_share_map: dict[int, list[int]] = defaultdict(list)
    try:
        async with db.begin_nested():
            r = await db.execute(select(UserDeptSharing))
            for ds in r.scalars().all():
                dept_share_map[ds.user_id].append(ds.department_id)
    except Exception:
        logger.warning("user_dept_sharing 查询失败")

    # 4. 构建输出
    out: list[UserPermissionOut] = []
    for uid, entry in user_map.items():
        shared_users = [
            VisibleUserItem(user_id=tid, user_name=all_users_map[tid].name)
            for tid in user_share_map.get(uid, [])
            if tid in all_users_map
        ]
        shared_depts = [
            DeptBrief(department_id=did, department_name=all_depts_map[did].name)
            for did in dept_share_map.get(uid, [])
            if did in all_depts_map
        ]

        out.append(UserPermissionOut(
            user_id=entry["user_id"],
            user_name=entry["user_name"],
            feishu_open_id=entry["feishu_open_id"],
            role=entry["role"],
            dept_list=entry["dept_list"],
            is_manager=entry["is_manager"],
            shared_to_users=shared_users,
            shared_to_depts=shared_depts,
        ))

    return out


# ── 自助分享 ──

async def _save_sharing(user_id: int, body: SetSharingRequest, db: AsyncSession):
    """内部函数：保存分享设置（用户级 + 部门级，全量替换）。"""
    # 用户级
    await db.execute(
        delete(UserVisibilityOverride).where(UserVisibilityOverride.user_id == user_id)
    )
    for tid in body.user_ids:
        if tid == user_id:
            continue
        db.add(UserVisibilityOverride(user_id=user_id, target_user_id=tid))

    # 部门级
    await db.execute(
        delete(UserDeptSharing).where(UserDeptSharing.user_id == user_id)
    )
    for did in body.department_ids:
        db.add(UserDeptSharing(user_id=user_id, department_id=did))

    await db.commit()


@router.put("/my/sharing", summary="设置我的数据分享")
async def set_my_sharing(
    body: SetSharingRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """普通用户设置自己的数据分享给谁。"""
    await _save_sharing(current_user.id, body, db)
    return {"message": "数据分享设置已更新"}


@router.put("/users/{user_id}/visibility", summary="管理员设置用户数据分享")
async def set_user_visibility(
    user_id: int,
    body: SetSharingRequest,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """管理员设置某用户的数据分享。"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "用户不存在")
    await _save_sharing(user_id, body, db)
    return {"message": f"已更新用户 {user.name} 的数据分享设置"}
