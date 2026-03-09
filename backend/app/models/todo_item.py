"""待办事项模型。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TodoItem(Base):
    __tablename__ = "todo_items"
    __table_args__ = (
        CheckConstraint(
            "priority IN ('low', 'medium', 'high')",
            name="ck_todo_priority",
        ),
        CheckConstraint(
            "source_type IN ('communication',)",
            name="ck_todo_source_type",
        ),
        CheckConstraint(
            "status IN ('pending_review', 'in_progress', 'dismissed', 'completed')",
            name="ck_todo_status",
        ),
        Index("idx_todo_owner", "owner_id"),
        Index("idx_todo_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[datetime | None] = mapped_column()
    priority: Mapped[str] = mapped_column(String(16), nullable=False, server_default="medium")
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[int | None] = mapped_column(Integer)
    source_text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="pending_review")
    feishu_task_id: Mapped[str | None] = mapped_column(String(128))
    pushed_at: Mapped[datetime | None] = mapped_column()
    content_hash: Mapped[str | None] = mapped_column(String(64))
    completed_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
