"""待办事项 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel

from app.schemas.types import UTCDatetime, UTCDatetimeOpt


class TodoExtractRequest(BaseModel):
    """AI提取待办请求。"""
    days: int = 7


class TodoOut(BaseModel):
    """待办输出模型。"""
    id: int
    owner_id: str
    title: str
    description: str | None = None
    due_date: UTCDatetimeOpt = None
    priority: str = "medium"
    source_type: str
    source_id: int | None = None
    source_text: str | None = None
    source_time: UTCDatetimeOpt = None
    status: str
    feishu_task_id: str | None = None
    confidence: float | None = None
    pushed_at: UTCDatetimeOpt = None
    completed_at: UTCDatetimeOpt = None
    cancelled_at: UTCDatetimeOpt = None
    created_at: UTCDatetime
    updated_at: UTCDatetime

    model_config = {"from_attributes": True}


class TodoUpdate(BaseModel):
    """待办更新模型。"""
    title: str | None = None
    description: str | None = None
    due_date: datetime | None = None
    priority: str | None = None
    status: str | None = None


class TodoStatusUpdate(BaseModel):
    """批量状态变更请求。"""
    ids: list[int]
    status: str


class TodoListResponse(BaseModel):
    """待办列表响应。"""
    items: list[TodoOut]
    total: int
