"""聊天相关的 Pydantic 模型。"""

from pydantic import BaseModel


class ChatMessage(BaseModel):
    """对话历史中的一条消息。"""
    role: str  # "user" 或 "assistant"
    content: str


class ChatRequest(BaseModel):
    """聊天请求体。"""
    question: str
    history: list[ChatMessage] = []
    conversation_id: int | None = None
    source_tables: list[str] | None = None
    source_ids: list[tuple[str, int]] | None = None
    attachment_context: str | None = None


class ChatResponse(BaseModel):
    """非流式聊天响应体。"""
    answer: str
    sources: list[str] = []  # feishu_record_id 列表
