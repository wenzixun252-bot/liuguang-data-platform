"""领导洞察 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel


class InsightGenerateRequest(BaseModel):
    """生成领导洞察请求。"""
    target_user_id: str
    target_user_name: str


class InsightOut(BaseModel):
    """洞察输出。"""
    id: int
    analyst_user_id: str
    target_user_id: str
    target_user_name: str
    report_markdown: str | None = None
    dimensions: dict = {}
    data_coverage: dict = {}
    generated_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class InsightListResponse(BaseModel):
    """洞察列表响应。"""
    items: list[InsightOut]
    total: int


class CandidateOut(BaseModel):
    """可分析的领导候选。"""
    user_id: str
    name: str
    meeting_count: int = 0
    message_count: int = 0
    document_count: int = 0
