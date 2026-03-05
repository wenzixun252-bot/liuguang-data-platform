"""关键词同步规则模型。"""

from datetime import datetime

from sqlalchemy import Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class KeywordSyncRule(Base):
    __tablename__ = "keyword_sync_rules"
    __table_args__ = (
        Index("uq_keyword_rule", "owner_id", "keyword", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    keyword: Mapped[str] = mapped_column(String(256), nullable=False)
    include_shared: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    default_tag_ids: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    is_enabled: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    last_scan_time: Mapped[datetime | None] = mapped_column()
    docs_matched: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
