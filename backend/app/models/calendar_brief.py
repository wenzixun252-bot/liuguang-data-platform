"""会前简报持久化模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CalendarBrief(Base):
    """已生成的会前简报，按 owner_id + event_id 持久化。"""

    __tablename__ = "calendar_briefs"
    __table_args__ = (
        Index("idx_cal_brief_owner_event", "owner_id", "event_id", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    event_id: Mapped[str] = mapped_column(String(256), nullable=False)
    event_summary: Mapped[str] = mapped_column(String(512), nullable=False, server_default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    chat_messages: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
