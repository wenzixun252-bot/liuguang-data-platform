"""结构化数据表模型：表级元数据 + 行级数据。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class StructuredTable(Base):
    """表级元数据：每个导入的表格一条记录。"""

    __tablename__ = "structured_tables"
    __table_args__ = (
        CheckConstraint(
            "source_type IN ('bitable', 'spreadsheet', 'local')",
            name="ck_structured_table_source_type",
        ),
        CheckConstraint(
            "parse_status IS NULL OR parse_status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_structured_table_parse_status",
        ),
        CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_structured_table_sentiment",
        ),
        UniqueConstraint(
            "owner_id",
            "source_app_token",
            "source_table_id",
            name="uq_structured_table_source",
        ),
        Index("idx_str_table_owner", "owner_id"),
        Index("idx_str_table_source_type", "source_type"),
        Index("idx_str_table_keywords", "keywords", postgresql_using="gin"),
        Index("idx_str_table_content_hash", "content_hash"),
        Index("idx_str_table_category", "table_category"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    table_category: Mapped[str | None] = mapped_column(String(64))
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_platform: Mapped[str | None] = mapped_column(String(32))
    source_app_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_table_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    feishu_record_id: Mapped[str | None] = mapped_column(String(128))
    file_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    schema_info: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    column_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_vector = mapped_column(Vector(settings.embedding_dimension), nullable=True)
    # -- LLM 提取的统一字段 --
    keywords: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    sentiment: Mapped[str | None] = mapped_column(String(16))
    # -- 数据质量字段 --
    quality_score: Mapped[float | None] = mapped_column(Float)
    duplicate_of: Mapped[int | None] = mapped_column(Integer)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    # -- 通用字段 --
    extra_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    parse_status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="done")
    processed_at: Mapped[datetime | None] = mapped_column()
    synced_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())


class StructuredTableRow(Base):
    """行级数据：用于预览和穿透搜索。"""

    __tablename__ = "structured_table_rows"
    __table_args__ = (
        Index("idx_str_row_table_id", "table_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    table_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("structured_tables.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    row_data: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    row_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
