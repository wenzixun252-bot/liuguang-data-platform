"""结构化数据表模型：表级元数据 + 行级数据。"""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StructuredTable(Base):
    """表级元数据：每个导入的表格一条记录。"""

    __tablename__ = "structured_tables"
    __table_args__ = (
        CheckConstraint(
            "source_type IN ('bitable', 'spreadsheet', 'local')",
            name="ck_structured_table_source_type",
        ),
        UniqueConstraint(
            "owner_id",
            "source_app_token",
            "source_table_id",
            name="uq_structured_table_source",
        ),
        Index("idx_str_table_owner", "owner_id"),
        Index("idx_str_table_source_type", "source_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_app_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_table_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    schema_info: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    column_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    synced_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())


class StructuredTableRow(Base):
    """行级数据：用于预览和穿透搜索。"""

    __tablename__ = "structured_table_rows"
    __table_args__ = (
        Index("idx_str_row_table_id", "table_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    table_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("structured_tables.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    row_data: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    row_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
