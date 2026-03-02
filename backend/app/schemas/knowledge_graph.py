"""知识图谱 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel


class KGEntityOut(BaseModel):
    """实体输出。"""
    id: int
    owner_id: str
    name: str
    entity_type: str
    properties: dict = {}
    mention_count: int = 1
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    created_at: datetime

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


class KGGraphResponse(BaseModel):
    """图谱数据（节点+边）。"""
    nodes: list[KGEntityOut]
    edges: list[KGRelationOut]


class KGStatsResponse(BaseModel):
    """图谱统计。"""
    total_entities: int
    total_relations: int
    entity_type_counts: dict = {}


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
