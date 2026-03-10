"""知识图谱 Pydantic 模型。"""

from pydantic import BaseModel

from app.schemas.types import UTCDatetime, UTCDatetimeOpt


class KGEntityOut(BaseModel):
    """实体输出。"""
    id: int
    owner_id: str
    name: str
    entity_type: str
    properties: dict = {}
    community_id: int | None = None
    importance_score: float = 0.0
    mention_count: int = 1
    first_seen_at: UTCDatetimeOpt = None
    last_seen_at: UTCDatetimeOpt = None
    created_at: UTCDatetime

    model_config = {"from_attributes": True}


class KGRelationOut(BaseModel):
    """关系输出。"""
    id: int
    source_entity_id: int
    target_entity_id: int
    relation_type: str
    weight: int = 1
    evidence_sources: list = []

    model_config = {"from_attributes": True}


class CommunityInfo(BaseModel):
    """社群信息（业务域）。"""
    community_id: int
    member_count: int
    top_entities: list[str] = []
    label: str = ""
    domain_label: str = ""


class InsightItem(BaseModel):
    """洞察/风险条目。"""
    title: str
    description: str
    type: str  # "insight" | "risk"
    severity: str = "medium"  # "high" | "medium" | "low"
    related_entity_ids: list[int] = []
    category: str = ""  # project | compliance | collaboration | resource
    evidence: str = ""
    suggested_action: str = ""


class AnalysisResponse(BaseModel):
    """图谱分析结果。"""
    communities: list[CommunityInfo] = []
    insights: list[InsightItem] = []
    risks: list[InsightItem] = []


class LinkedAsset(BaseModel):
    """关联资产。"""
    id: int
    title: str
    source_type: str
    asset_type: str = "document"  # "document" 或 "meeting"

    model_config = {"from_attributes": True}


class KGGraphResponse(BaseModel):
    """图谱数据（节点+边+社群）。"""
    nodes: list[KGEntityOut]
    edges: list[KGRelationOut]
    communities: list[CommunityInfo] = []


class KGStatsResponse(BaseModel):
    """图谱统计。"""
    total_entities: int
    total_relations: int
    entity_type_counts: dict = {}
    last_analysis_at: UTCDatetimeOpt = None


class KGSearchRequest(BaseModel):
    """实体搜索请求。"""
    query: str
    entity_type: str | None = None
    limit: int = 20


class KGEntityDetail(BaseModel):
    """实体详情+关联关系。"""
    entity: KGEntityOut
    relations: list[KGRelationOut]
    related_entities: list[KGEntityOut]
