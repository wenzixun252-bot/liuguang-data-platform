"""文档 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel, computed_field

from app.config import settings


class DocumentOut(BaseModel):
    """文档输出模型。"""
    id: int
    owner_id: str
    source_type: str
    source_app_token: str | None = None
    source_table_id: str | None = None
    title: str | None = None
    content_text: str
    summary: str | None = None
    author: str | None = None
    tags: dict = {}
    category: str | None = None
    file_type: str | None = None
    file_size: int | None = None
    doc_url: str | None = None
    uploader_name: str | None = None
    extra_fields: dict = {}
    feishu_record_id: str | None = None
    synced_at: datetime | None = None
    feishu_created_at: datetime | None = None
    feishu_updated_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

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


class DocumentListResponse(BaseModel):
    """分页文档列表响应。"""
    items: list[DocumentOut]
    total: int
    page: int
    page_size: int
