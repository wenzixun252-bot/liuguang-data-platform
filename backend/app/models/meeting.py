"""会议模型。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, Float, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        CheckConstraint(
            "parse_status IS NULL OR parse_status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_meetings_parse_status",
        ),
        CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_meetings_sentiment",
        ),
        Index("idx_meeting_owner", "owner_id"),
        Index("idx_meeting_time", "meeting_time"),
        Index("idx_meeting_keywords", "keywords", postgresql_using="gin"),
        Index("idx_meeting_content_hash", "content_hash"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_platform: Mapped[str | None] = mapped_column(String(32))
    source_app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    source_table_id: Mapped[str | None] = mapped_column(String(128))
    feishu_record_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    title: Mapped[str | None] = mapped_column(String(512))
    meeting_time: Mapped[datetime | None] = mapped_column()
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    location: Mapped[str | None] = mapped_column(String(512))
    organizer: Mapped[str | None] = mapped_column(String(256))
    participants: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    agenda: Mapped[str | None] = mapped_column(Text)
    conclusions: Mapped[str | None] = mapped_column(Text)
    action_items: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str | None] = mapped_column(Text)
    recording_url: Mapped[str | None] = mapped_column(String(1024))
    minutes_url: Mapped[str | None] = mapped_column(String(1024))
    source_url: Mapped[str | None] = mapped_column(String(1024))
    uploader_name: Mapped[str | None] = mapped_column(String(256))
    content_vector = mapped_column(Vector(settings.embedding_dimension), nullable=True)
    # -- LLM 提取的统一字段 --
    keywords: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    involved_people: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
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
    synced_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
