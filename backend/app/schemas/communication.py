"""沟通资产 Schema。"""

from datetime import datetime

from pydantic import BaseModel


class CommunicationOut(BaseModel):
    """沟通记录响应模型。"""
    id: int
    owner_id: str
    comm_type: str
    source_platform: str | None = None
    source_app_token: str
    source_table_id: str | None = None
    feishu_record_id: str
    title: str | None = None
    comm_time: datetime | None = None
    initiator: str | None = None
    participants: list = []
    duration_minutes: int | None = None
    location: str | None = None
    agenda: str | None = None
    conclusions: str | None = None
    action_items: list = []
    transcript: str | None = None
    recording_url: str | None = None
    chat_id: str | None = None
    chat_type: str | None = None
    chat_name: str | None = None
    message_type: str | None = None
    reply_to: str | None = None
    content_text: str
    summary: str | None = None
    source_url: str | None = None
    uploader_name: str | None = None
    keywords: list = []
    sentiment: str | None = None
    quality_score: float | None = None
    duplicate_of: int | None = None
    extra_fields: dict = {}
    feishu_created_at: datetime | None = None
    feishu_updated_at: datetime | None = None
    parse_status: str = "done"
    processed_at: datetime | None = None
    synced_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CommunicationListResponse(BaseModel):
    """沟通记录列表响应。"""
    items: list[CommunicationOut]
    total: int
    page: int
    page_size: int
