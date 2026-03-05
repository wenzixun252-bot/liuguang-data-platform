"""标签系统模型：标签定义 + 内容标签关联。"""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TagDefinition(Base):
    """标签定义表 — 用户自定义或系统预置标签。"""

    __tablename__ = "tag_definitions"
    __table_args__ = (
        CheckConstraint(
            "category IN ('project', 'priority', 'topic', 'custom')",
            name="ck_tag_def_category",
        ),
        UniqueConstraint("owner_id", "name", name="uq_tag_def_owner_name"),
        Index("idx_tag_def_owner", "owner_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, server_default="custom")
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    color: Mapped[str] = mapped_column(String(16), nullable=False, server_default="#6366f1")
    is_shared: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())


class ContentTag(Base):
    """内容标签关联表 — 将标签打到具体内容上。"""

    __tablename__ = "content_tags"
    __table_args__ = (
        CheckConstraint(
            "content_type IN ('document', 'meeting', 'chat_message', 'structured_table')",
            name="ck_content_tag_type",
        ),
        CheckConstraint(
            "tagged_by IN ('user_manual', 'source_inherit', 'ai_suggest')",
            name="ck_content_tag_by",
        ),
        UniqueConstraint("tag_id", "content_type", "content_id", name="uq_content_tag"),
        Index("idx_content_tag_content", "content_type", "content_id"),
        Index("idx_content_tag_tag", "tag_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tag_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tag_definitions.id", ondelete="CASCADE"),
        nullable=False,
    )
    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    content_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tagged_by: Mapped[str] = mapped_column(String(16), nullable=False, server_default="user_manual")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, server_default="1.0")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
