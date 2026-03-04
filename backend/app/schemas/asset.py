"""资产统计 Pydantic 模型。"""

from pydantic import BaseModel


class AssetStatsResponse(BaseModel):
    """统一看板统计响应。"""
    total: int
    by_table: dict[str, int]
    today_new: dict[str, int]
    recent_trend: list[dict]
