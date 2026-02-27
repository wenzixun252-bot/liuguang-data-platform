"""数据资产相关的 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel


class AssetOut(BaseModel):
    """数据资产输出模型。"""
    feishu_record_id: str
    title: str | None = None
    asset_type: str
    content_text: str
    asset_tags: dict = {}
    synced_at: datetime
    feishu_created_at: datetime | None = None
    feishu_updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class AssetListResponse(BaseModel):
    """分页资产列表响应。"""
    items: list[AssetOut]
    total: int
    page: int
    page_size: int


class AssetStatsResponse(BaseModel):
    """资产统计响应。"""
    total: int
    by_type: dict[str, int]
    recent_trend: list[dict]
