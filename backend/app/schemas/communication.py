"""沟通资产 Schema。"""

from pydantic import BaseModel, computed_field

from app.schemas.types import UTCDatetime, UTCDatetimeOpt

from app.config import settings


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
    comm_time: UTCDatetimeOpt = None
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
    feishu_created_at: UTCDatetimeOpt = None
    feishu_updated_at: UTCDatetimeOpt = None
    parse_status: str = "done"
    processed_at: UTCDatetimeOpt = None
    synced_at: UTCDatetimeOpt = None
    created_at: UTCDatetime
    updated_at: UTCDatetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def bitable_url(self) -> str | None:
        """构建源多维表格链接。"""
        if not self.source_app_token or not settings.feishu_base_domain:
            return None
        url = f"https://{settings.feishu_base_domain}/base/{self.source_app_token}"
        if self.source_table_id:
            url += f"?table={self.source_table_id}"
        return url


class CommunicationListResponse(BaseModel):
    """沟通记录列表响应。"""
    items: list[CommunicationOut]
    total: int
    page: int
    page_size: int
