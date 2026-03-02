"""用户模型。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('employee', 'admin')", name="ck_users_role"),
        Index("idx_users_role", "role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    feishu_open_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    feishu_union_id: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(1024))
    email: Mapped[str | None] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(16), nullable=False, server_default="employee")
    feishu_access_token: Mapped[str | None] = mapped_column(String(512))
    feishu_refresh_token: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
