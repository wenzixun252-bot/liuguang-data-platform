"""标签系统 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel


class TagDefinitionCreate(BaseModel):
    category: str = "custom"
    name: str
    color: str = "#6366f1"
    is_shared: bool = False


class TagDefinitionUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    is_shared: bool | None = None


class TagDefinitionOut(BaseModel):
    id: int
    owner_id: str | None = None
    category: str
    name: str
    color: str
    is_shared: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentTagCreate(BaseModel):
    tag_id: int
    content_type: str
    content_id: int


class BatchTagRequest(BaseModel):
    tag_ids: list[int]
    content_type: str
    content_ids: list[int]


class ContentTagOut(BaseModel):
    id: int
    tag_id: int
    tag_name: str = ""
    tag_color: str = ""
    content_type: str
    content_id: int
    tagged_by: str
    confidence: float

    model_config = {"from_attributes": True}


class DetachRequest(BaseModel):
    tag_id: int
    content_type: str
    content_id: int
