"""文档 Pydantic 模型。"""

from pydantic import BaseModel, computed_field

from app.config import settings
from app.schemas.types import UTCDatetime, UTCDatetimeOpt


class DocumentOut(BaseModel):
    """文档输出模型。"""
    id: int
    owner_id: str
    source_type: str
    source_platform: str | None = None
    source_app_token: str | None = None
    source_table_id: str | None = None
    title: str | None = None
    original_filename: str | None = None
    content_text: str
    summary: str | None = None
    author: str | None = None
    file_type: str | None = None
    file_size: int | None = None
    source_url: str | None = None
    asset_owner_name: str | None = None
    uploader_name: str | None = None
    keywords: list = []
    sentiment: str | None = None
    quality_score: float | None = None
    duplicate_of: int | None = None
    key_info: dict | None = None
    extraction_rule_id: int | None = None
    extra_fields: dict = {}
    feishu_record_id: str | None = None
    parse_status: str = "done"
    processed_at: UTCDatetimeOpt = None
    import_count: int = 1
    synced_at: UTCDatetimeOpt = None
    feishu_created_at: UTCDatetimeOpt = None
    feishu_updated_at: UTCDatetimeOpt = None
    created_at: UTCDatetime
    updated_at: UTCDatetime

    matched_fields: list[str] = []

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
