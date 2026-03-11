"""结构化数据清洗规则模型。"""

from datetime import datetime

from sqlalchemy import Boolean, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CleaningRule(Base):
    __tablename__ = "cleaning_rules"
    __table_args__ = (
        Index("idx_cleaning_rule_owner", "owner_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    options: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default='{"dedup": true, "drop_empty_rows": true, "empty_threshold": 0.5, "normalize_dates": true, "normalize_numbers": true, "trim_whitespace": true, "llm_field_merge": true, "llm_field_clean": true}')
    field_hint: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
