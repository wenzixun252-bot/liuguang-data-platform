"""对话会话相关的 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel


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
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationOut(BaseModel):
    id: int
    owner_id: str
    title: str
    scene: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetailOut(ConversationOut):
    messages: list[ConversationMessageOut] = []
