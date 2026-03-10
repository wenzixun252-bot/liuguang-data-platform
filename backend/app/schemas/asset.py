"""资产统计 Pydantic 模型。"""

from pydantic import BaseModel


class AssetStatsResponse(BaseModel):
    """统一看板统计响应。"""
    total: int
    by_table: dict[str, int]
    today_new: dict[str, int]
    recent_trend: list[dict]


class ScoreAction(BaseModel):
    label: str
    route: str


class ScoreDimension(BaseModel):
    key: str
    label: str
    score: int
    detail: str
    action: ScoreAction | None = None


class AssetScoreResponse(BaseModel):
    total_score: int
    level: str
    dimensions: list[ScoreDimension]
