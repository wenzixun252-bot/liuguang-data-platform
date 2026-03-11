"""沟通资产模型（合并会议 + 会话 + 录音）。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, Float, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class Communication(Base):
    __tablename__ = "communications"
    __table_args__ = (
        CheckConstraint(
            "comm_type IN ('meeting', 'chat', 'recording')",
            name="ck_communications_comm_type",
        ),
        CheckConstraint(
            "parse_status IS NULL OR parse_status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_communications_parse_status",
        ),
        CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_communications_sentiment",
        ),
        CheckConstraint(
            "chat_type IS NULL OR chat_type IN ('group', 'private')",
            name="ck_communications_chat_type",
        ),
        Index("idx_comm_owner", "owner_id"),
        Index("idx_comm_type", "comm_type"),
        Index("idx_comm_time", "comm_time"),
        Index("idx_comm_keywords", "keywords", postgresql_using="gin"),
        Index("idx_comm_content_hash", "content_hash"),
        Index("idx_comm_chat_id", "chat_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    comm_type: Mapped[str] = mapped_column(String(16), nullable=False)
    source_platform: Mapped[str | None] = mapped_column(String(32))
    source_app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    source_table_id: Mapped[str | None] = mapped_column(String(128))
    feishu_record_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    # -- 合并字段 --
    title: Mapped[str | None] = mapped_column(String(512))
    comm_time: Mapped[datetime | None] = mapped_column()
    initiator: Mapped[str | None] = mapped_column(String(256))
    participants: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    # -- 会议独有字段 --
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    location: Mapped[str | None] = mapped_column(String(512))
    agenda: Mapped[str | None] = mapped_column(Text)
    conclusions: Mapped[str | None] = mapped_column(Text)
    action_items: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    transcript: Mapped[str | None] = mapped_column(Text)
    recording_url: Mapped[str | None] = mapped_column(String(1024))
    # -- 会话独有字段 --
    chat_id: Mapped[str | None] = mapped_column(String(256))
    chat_type: Mapped[str | None] = mapped_column(String(16))
    chat_name: Mapped[str | None] = mapped_column(String(256))
    message_type: Mapped[str | None] = mapped_column(String(64))
    reply_to: Mapped[str | None] = mapped_column(String(128))
    # -- 通用内容字段 --
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
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
    # -- 个人化提取字段 --
    key_info: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    extraction_rule_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # -- 通用字段 --
    extra_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    feishu_created_at: Mapped[datetime | None] = mapped_column()
    feishu_updated_at: Mapped[datetime | None] = mapped_column()
    parse_status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="done")
    processed_at: Mapped[datetime | None] = mapped_column()
    synced_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
