"""日程提醒偏好模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CalendarReminderPref(Base):
    """用户的日程提醒偏好设置。"""

    __tablename__ = "calendar_reminder_prefs"
    __table_args__ = (
        Index("idx_cal_reminder_owner", "owner_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    minutes_before: Mapped[int] = mapped_column(Integer, nullable=False, server_default="30")
    last_reminded_event_id: Mapped[str | None] = mapped_column(String(256))
    reminded_event_ids: Mapped[list | None] = mapped_column(JSONB, server_default="[]")
    last_reminded_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
