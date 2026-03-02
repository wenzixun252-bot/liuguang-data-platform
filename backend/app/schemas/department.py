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


class DeptBrief(BaseModel):
    """部门简要信息。"""
    department_id: int
    department_name: str


class VisibleUserItem(BaseModel):
    """可见用户项。"""
    user_id: int
    user_name: str


class UserPermissionOut(BaseModel):
    """用户权限完整信息。"""
    user_id: int
    user_name: str
    feishu_open_id: str
    role: str
    dept_list: list[DeptBrief]
    is_manager: bool
    shared_to_users: list[VisibleUserItem]
    shared_to_depts: list[DeptBrief]


class SetSharingRequest(BaseModel):
    """设置分享请求体（同时支持用户和部门）。"""
    user_ids: list[int] = []
    department_ids: list[int] = []
