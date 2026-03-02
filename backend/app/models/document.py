"""文档模型。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, Index, Integer, String, Text, func
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
        Index("idx_doc_owner", "owner_id"),
        Index("idx_doc_source_type", "source_type"),
        Index(
            "idx_doc_feishu_rid",
            "feishu_record_id",
            unique=True,
            postgresql_where="feishu_record_id IS NOT NULL",
        ),
        Index("idx_doc_tags", "tags", postgresql_using="gin"),
        Index("idx_doc_extra", "extra_fields", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False)
    source_app_token: Mapped[str | None] = mapped_column(String(128))
    source_table_id: Mapped[str | None] = mapped_column(String(128))
    feishu_record_id: Mapped[str | None] = mapped_column(String(128))
    title: Mapped[str | None] = mapped_column(String(512))
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    author: Mapped[str | None] = mapped_column(String(256))
    tags: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    category: Mapped[str | None] = mapped_column(String(128))
    file_type: Mapped[str | None] = mapped_column(String(64))
    file_size: Mapped[int | None] = mapped_column(Integer)
    file_path: Mapped[str | None] = mapped_column(String(1024))
    doc_url: Mapped[str | None] = mapped_column(String(1024))
    uploader_name: Mapped[str | None] = mapped_column(String(256))
    content_vector = mapped_column(Vector(settings.embedding_dimension), nullable=True)
    extra_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    feishu_created_at: Mapped[datetime | None] = mapped_column()
    feishu_updated_at: Mapped[datetime | None] = mapped_column()
    synced_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
