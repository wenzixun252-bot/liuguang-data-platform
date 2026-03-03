"""报告 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel


class ReportTemplateOut(BaseModel):
    """报告模板输出。"""
    id: int
    name: str
    template_type: str
    owner_id: str | None = None
    prompt_template: str
    output_structure: dict = {}
    description: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportTemplateCreate(BaseModel):
    """创建自定义模板。"""
    name: str
    prompt_template: str
    output_structure: dict = {}
    description: str | None = None


class ReportGenerateRequest(BaseModel):
    """生成报告请求。"""
    template_id: int
    title: str
    time_range_start: datetime
    time_range_end: datetime
    data_sources: list[str] = ["document", "meeting", "chat_message"]
    extra_instructions: str | None = None
    target_reader_ids: list[str] | None = None


class ReportOut(BaseModel):
    """报告输出。"""
    id: int
    owner_id: str
    template_id: int | None = None
    title: str
    content_markdown: str | None = None
    status: str
    time_range_start: datetime | None = None
    time_range_end: datetime | None = None
    data_sources_used: dict = {}
    target_readers: list | None = None
    feishu_doc_token: str | None = None
    feishu_doc_url: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReportUpdate(BaseModel):
    """编辑报告。"""
    title: str | None = None
    content_markdown: str | None = None


class ReportListResponse(BaseModel):
    """报告列表响应。"""
    items: list[ReportOut]
    total: int
