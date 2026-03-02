"""会议 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel, computed_field

from app.config import settings


class MeetingOut(BaseModel):
    """会议输出模型。"""
    id: int
    owner_id: str
    source_app_token: str | None = None
    source_table_id: str | None = None
    title: str | None = None
    meeting_time: datetime | None = None
    duration_minutes: int | None = None
    location: str | None = None
    organizer: str | None = None
    participants: list = []
    agenda: str | None = None
    conclusions: str | None = None
    action_items: list = []
    content_text: str
    minutes_url: str | None = None
    uploader_name: str | None = None
    extra_fields: dict = {}
    feishu_record_id: str
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


class MeetingListResponse(BaseModel):
    """分页会议列表响应。"""
    items: list[MeetingOut]
    total: int
    page: int
    page_size: int
