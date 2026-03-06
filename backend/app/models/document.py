"""文档模型。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, Float, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint(
            "source_type IN ('cloud', 'local')",
            name="ck_documents_source_type",
        ),
        CheckConstraint(
            "parse_status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_documents_parse_status",
        ),
        CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_documents_sentiment",
        ),
        Index("idx_doc_owner", "owner_id"),
        Index("idx_doc_source_type", "source_type"),
        Index(
            "idx_doc_feishu_rid",
            "feishu_record_id",
            "owner_id",
            unique=True,
            postgresql_where="feishu_record_id IS NOT NULL",
        ),
        Index("idx_doc_extra", "extra_fields", postgresql_using="gin"),
        Index("idx_doc_keywords", "keywords", postgresql_using="gin"),
        Index("idx_doc_content_hash", "content_hash"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False)
    source_platform: Mapped[str | None] = mapped_column(String(32))
    source_app_token: Mapped[str | None] = mapped_column(String(128))
    source_table_id: Mapped[str | None] = mapped_column(String(128))
    feishu_record_id: Mapped[str | None] = mapped_column(String(128))
    title: Mapped[str | None] = mapped_column(String(512))
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    author: Mapped[str | None] = mapped_column(String(256))
    file_type: Mapped[str | None] = mapped_column(String(64))
    file_size: Mapped[int | None] = mapped_column(Integer)
    file_path: Mapped[str | None] = mapped_column(String(1024))
    source_url: Mapped[str | None] = mapped_column(String(1024))
    uploader_name: Mapped[str | None] = mapped_column(String(256))
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
    feishu_created_at: Mapped[datetime | None] = mapped_column()
    feishu_updated_at: Mapped[datetime | None] = mapped_column()
    parse_status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="done")
    processed_at: Mapped[datetime | None] = mapped_column()
    synced_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
