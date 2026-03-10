"""对话会话相关的 Pydantic 模型。"""

from pydantic import BaseModel

from app.schemas.types import UTCDatetime


class ConversationCreate(BaseModel):
    title: str = "新对话"
    scene: str = "chat"


class ConversationUpdate(BaseModel):
    title: str


class ConversationMessageOut(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    sources: list | None = None
    attachments: list | None = None
    created_at: UTCDatetime

    model_config = {"from_attributes": True}


class ConversationOut(BaseModel):
    id: int
    owner_id: str
    title: str
    scene: str
    created_at: UTCDatetime
    updated_at: UTCDatetime

    model_config = {"from_attributes": True}


class ConversationDetailOut(ConversationOut):
    messages: list[ConversationMessageOut] = []
