"""用户与鉴权相关的 Pydantic 模型。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class FeishuCallbackRequest(BaseModel):
    """飞书 OAuth 回调请求体。"""
    code: str


class UserOut(BaseModel):
    """用户信息响应体。"""
    id: int
    feishu_open_id: str
    feishu_union_id: str | None = None
    name: str
    avatar_url: str | None = None
    email: str | None = None
    role: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    """登录成功响应体。"""
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class RoleUpdateRequest(BaseModel):
    """修改用户角色请求体。"""
    role: Literal["employee", "executive", "admin"]
