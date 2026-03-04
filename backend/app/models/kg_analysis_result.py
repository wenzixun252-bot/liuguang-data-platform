"""知识图谱分析结果持久化模型。"""

from datetime import datetime

from sqlalchemy import Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class KGAnalysisResult(Base):
    __tablename__ = "kg_analysis_results"
    __table_args__ = (
        Index("idx_kg_analysis_owner", "owner_id"),
        Index("idx_kg_analysis_generated", "generated_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    communities: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    insights: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    risks: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    generated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
