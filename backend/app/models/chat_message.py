"""聊天消息模型。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, Float, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        CheckConstraint(
            "parse_status IS NULL OR parse_status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_chat_messages_parse_status",
        ),
        CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_chat_messages_sentiment",
        ),
        CheckConstraint(
            "chat_type IS NULL OR chat_type IN ('group', 'private')",
            name="ck_chat_messages_chat_type",
        ),
        Index("idx_chat_owner", "owner_id"),
        Index("idx_chat_id", "chat_id"),
        Index("idx_chat_sent_at", "sent_at"),
        Index("idx_chat_keywords", "keywords", postgresql_using="gin"),
        Index("idx_chat_content_hash", "content_hash"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_platform: Mapped[str | None] = mapped_column(String(32))
    source_app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    source_table_id: Mapped[str | None] = mapped_column(String(128))
    feishu_record_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    chat_id: Mapped[str | None] = mapped_column(String(256))
    chat_type: Mapped[str | None] = mapped_column(String(16))
    chat_name: Mapped[str | None] = mapped_column(String(256))
    sender: Mapped[str | None] = mapped_column(String(256))
    message_type: Mapped[str | None] = mapped_column(String(64))
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column()
    reply_to: Mapped[str | None] = mapped_column(String(128))
    mentions: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
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
    parse_status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="done")
    processed_at: Mapped[datetime | None] = mapped_column()
    synced_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
