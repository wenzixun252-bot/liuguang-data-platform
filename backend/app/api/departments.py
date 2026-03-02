"""部门管理接口。"""

import logging
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.models.department import Department, UserDepartment, UserVisibilityOverride
from app.models.user import User
from app.schemas.department import (
    DepartmentNode,
    SetVisibilityRequest,
    UserDepartmentOut,
    UserPermissionOut,
    VisibleDeptItem,
)
from app.services.department_sync import sync_departments, sync_user_departments
from app.services.feishu import FeishuAPIError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/departments", tags=["部门管理"])


@router.post("/sync", summary="同步飞书部门数据（管理员）")
async def trigger_department_sync(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """从飞书拉取部门树和用户部门关系。"""
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

    # 构建树
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


@router.patch("/users/{user_id}/manager", summary="设置/取消部门管理者")
async def toggle_manager(
    user_id: int,
    department_id: int,
    is_manager: bool,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """设置或取消用户在某部门的 manager 身份。"""
    result = await db.execute(
        select(UserDepartment).where(
            UserDepartment.user_id == user_id,
            UserDepartment.department_id == department_id,
        )
    )
    ud = result.scalar_one_or_none()
    if not ud:
        raise HTTPException(404, "用户部门关系不存在")

    ud.is_manager = is_manager
    await db.commit()
    return {"message": f"已{'设置' if is_manager else '取消'}管理者身份"}


@router.patch("/users/{user_id}/role", summary="设置用户角色")
async def set_user_role(
    user_id: int,
    role: str,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """设置用户角色: admin(系统管理员) / employee(普通用户)。
    部门管理员通过 is_manager 标识，角色仍为 employee。
    """
    if role not in ("admin", "employee"):
        raise HTTPException(400, "角色只能为 admin 或 employee")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "用户不存在")

    user.role = role
    await db.commit()
    return {"message": f"用户 {user.name} 角色已设为 {role}"}


@router.get("/users/permissions", response_model=list[UserPermissionOut], summary="获取用户权限列表")
async def list_user_permissions(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UserPermissionOut]:
    """返回所有用户的权限信息，包括自动可见部门和手动覆盖可见部门。"""
    # 1. 查询所有用户部门关系
    result = await db.execute(
        select(UserDepartment, User, Department)
        .join(User, UserDepartment.user_id == User.id)
        .join(Department, UserDepartment.department_id == Department.id)
        .order_by(User.name)
    )
    rows = result.all()

    # 构建部门 id->name 映射
    dept_result = await db.execute(select(Department))
    all_depts = {d.id: d.name for d in dept_result.scalars().all()}

    # 按 user_id 聚合
    user_map: dict[int, dict] = {}
    for ud, user, dept in rows:
        if user.id not in user_map:
            user_map[user.id] = {
                "user_id": user.id,
                "user_name": user.name,
                "feishu_open_id": user.feishu_open_id,
                "role": user.role,
                "departments": [],
                "is_manager": False,
                "managed_dept_ids": [],
            }
        entry = user_map[user.id]
        if dept.name not in entry["departments"]:
            entry["departments"].append(dept.name)
        if ud.is_manager:
            entry["is_manager"] = True
            entry["managed_dept_ids"].append(ud.department_id)

    # 2. 查询所有 override
    override_result = await db.execute(select(UserVisibilityOverride))
    overrides = override_result.scalars().all()
    override_map: dict[int, list[int]] = defaultdict(list)
    for ov in overrides:
        override_map[ov.user_id].append(ov.department_id)

    # 3. 计算自动可见部门（manager 的递归下属部门）
    out: list[UserPermissionOut] = []
    for uid, entry in user_map.items():
        auto_visible: list[VisibleDeptItem] = []
        if entry["managed_dept_ids"]:
            dept_ids = entry["managed_dept_ids"]
            placeholders = ", ".join(f":dept_{i}" for i in range(len(dept_ids)))
            params = {f"dept_{i}": did for i, did in enumerate(dept_ids)}
            cte_sql = text(f"""
                WITH RECURSIVE dept_tree AS (
                    SELECT id FROM departments WHERE id IN ({placeholders})
                    UNION ALL
                    SELECT d.id FROM departments d
                    INNER JOIN dept_tree dt ON d.parent_id = dt.id
                )
                SELECT DISTINCT id FROM dept_tree
            """)
            cte_result = await db.execute(cte_sql, params)
            auto_dept_ids = {row[0] for row in cte_result.fetchall()}
            auto_visible = [
                VisibleDeptItem(department_id=did, department_name=all_depts.get(did, ""))
                for did in sorted(auto_dept_ids)
                if did in all_depts
            ]

        override_visible = [
            VisibleDeptItem(department_id=did, department_name=all_depts.get(did, ""))
            for did in override_map.get(uid, [])
            if did in all_depts
        ]

        out.append(UserPermissionOut(
            user_id=entry["user_id"],
            user_name=entry["user_name"],
            feishu_open_id=entry["feishu_open_id"],
            role=entry["role"],
            departments=entry["departments"],
            is_manager=entry["is_manager"],
            auto_visible_depts=auto_visible,
            override_visible_depts=override_visible,
        ))

    return out


@router.put("/users/{user_id}/visibility", summary="设置用户数据可见范围")
async def set_user_visibility(
    user_id: int,
    body: SetVisibilityRequest,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """管理员设置用户的数据可见范围（全量替换）。"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "用户不存在")

    # 全量替换：先删除旧的，再插入新的
    await db.execute(
        delete(UserVisibilityOverride).where(UserVisibilityOverride.user_id == user_id)
    )

    for dept_id in body.department_ids:
        dept = await db.get(Department, dept_id)
        if not dept:
            raise HTTPException(400, f"部门 ID {dept_id} 不存在")
        db.add(UserVisibilityOverride(user_id=user_id, department_id=dept_id))

    await db.commit()
    return {"message": f"已更新用户 {user.name} 的数据可见范围"}
