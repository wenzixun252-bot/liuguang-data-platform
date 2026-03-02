"""领导风格洞察模型。"""

from datetime import datetime

from sqlalchemy import Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LeadershipInsight(Base):
    __tablename__ = "leadership_insights"
    __table_args__ = (
        Index("idx_insight_analyst", "analyst_user_id"),
        Index("idx_insight_target", "target_user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    analyst_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    target_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    target_user_name: Mapped[str] = mapped_column(String(128), nullable=False)
    report_markdown: Mapped[str | None] = mapped_column(Text)
    dimensions: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    data_coverage: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    generated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
