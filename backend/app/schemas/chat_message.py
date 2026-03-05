"""聊天消息 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel, computed_field

from app.config import settings


class ChatMessageOut(BaseModel):
    """聊天消息输出模型。"""
    id: int
    owner_id: str
    source_platform: str | None = None
    source_app_token: str | None = None
    source_table_id: str | None = None
    chat_id: str | None = None
    chat_type: str | None = None
    chat_name: str | None = None
    sender: str | None = None
    message_type: str | None = None
    content_text: str
    summary: str | None = None
    sent_at: datetime | None = None
    reply_to: str | None = None
    mentions: list = []
    source_url: str | None = None
    uploader_name: str | None = None
    keywords: list = []
    involved_people: list = []
    sentiment: str | None = None
    quality_score: float | None = None
    duplicate_of: int | None = None
    extra_fields: dict = {}
    feishu_record_id: str
    parse_status: str = "done"
    synced_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def bitable_url(self) -> str | None:
        if not self.source_app_token or not settings.feishu_base_domain:
            return None
        url = f"https://{settings.feishu_base_domain}/base/{self.source_app_token}"
        if self.source_table_id:
            url += f"?table={self.source_table_id}"
        return url


class ChatMessageListResponse(BaseModel):
    """分页聊天消息列表响应。"""
    items: list[ChatMessageOut]
    total: int
    page: int
    page_size: int
