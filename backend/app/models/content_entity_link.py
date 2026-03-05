"""内容-实体锚定模型：将知识图谱实体精确关联到具体内容记录。"""

from datetime import datetime

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ContentEntityLink(Base):
    """内容-实体关联表。"""

    __tablename__ = "content_entity_links"
    __table_args__ = (
        UniqueConstraint("entity_id", "content_type", "content_id", name="uq_cel"),
        Index("idx_cel_entity", "entity_id"),
        Index("idx_cel_content", "content_type", "content_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("kg_entities.id", ondelete="CASCADE"),
        nullable=False,
    )
    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    content_id: Mapped[int] = mapped_column(Integer, nullable=False)
    relation_type: Mapped[str] = mapped_column(String(32), nullable=False, server_default="mentioned_in")
    context_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
