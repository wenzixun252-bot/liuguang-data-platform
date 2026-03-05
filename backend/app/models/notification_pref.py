"""用户通知偏好模型。"""

from datetime import datetime

from sqlalchemy import String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserNotificationPref(Base):
    __tablename__ = "user_notification_prefs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    on_sync_completed: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    on_sync_failed: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    on_new_data: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    on_tag_suggestion: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    on_share_received: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
