"""知识图谱模型：实体与关系。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class KGEntity(Base):
    __tablename__ = "kg_entities"
    __table_args__ = (
        CheckConstraint(
            "entity_type IN ('person', 'project', 'topic', 'organization', 'event', 'document')",
            name="ck_kg_entity_type",
        ),
        Index("idx_kg_entity_owner", "owner_id"),
        Index("idx_kg_entity_type", "entity_type"),
        Index("idx_kg_entity_name", "name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    properties: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    mention_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    first_seen_at: Mapped[datetime | None] = mapped_column()
    last_seen_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())


class KGRelation(Base):
    __tablename__ = "kg_relations"
    __table_args__ = (
        CheckConstraint(
            "relation_type IN ('collaborates_with', 'works_on', 'discusses', 'belongs_to', 'related_to')",
            name="ck_kg_relation_type",
        ),
        Index("idx_kg_rel_owner", "owner_id"),
        Index("idx_kg_rel_source", "source_entity_id"),
        Index("idx_kg_rel_target", "target_entity_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_entity_id: Mapped[int] = mapped_column(Integer, ForeignKey("kg_entities.id", ondelete="CASCADE"), nullable=False)
    target_entity_id: Mapped[int] = mapped_column(Integer, ForeignKey("kg_entities.id", ondelete="CASCADE"), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(32), nullable=False)
    weight: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    evidence_sources: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
