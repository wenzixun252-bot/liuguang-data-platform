"""部门 Pydantic 模型。"""

from __future__ import annotations

from pydantic import BaseModel


class DepartmentNode(BaseModel):
    """部门树节点。"""
    id: int
    feishu_department_id: str
    name: str
    parent_id: int | None = None
    children: list[DepartmentNode] = []


class UserDepartmentOut(BaseModel):
    """用户部门关系输出。"""
    id: int
    user_id: int
    user_name: str
    feishu_open_id: str
    department_id: int
    department_name: str
    is_manager: bool
    role: str = "employee"


class VisibleDeptItem(BaseModel):
    """可见部门项。"""
    department_id: int
    department_name: str


class UserPermissionOut(BaseModel):
    """用户权限完整信息。"""
    user_id: int
    user_name: str
    feishu_open_id: str
    role: str
    departments: list[str]
    is_manager: bool
    auto_visible_depts: list[VisibleDeptItem]
    override_visible_depts: list[VisibleDeptItem]


class SetVisibilityRequest(BaseModel):
    """设置可见范围请求体。"""
    department_ids: list[int]
