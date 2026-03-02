"""报告与报告模板模型。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ReportTemplate(Base):
    __tablename__ = "report_templates"
    __table_args__ = (
        CheckConstraint(
            "template_type IN ('system', 'custom')",
            name="ck_report_tpl_type",
        ),
        Index("idx_report_tpl_owner", "owner_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    template_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="custom")
    owner_id: Mapped[str | None] = mapped_column(String(64))
    prompt_template: Mapped[str] = mapped_column(Text, nullable=False)
    output_structure: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'generating', 'completed', 'failed', 'published')",
            name="ck_report_status",
        ),
        Index("idx_report_owner", "owner_id"),
        Index("idx_report_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    template_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("report_templates.id"))
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    content_markdown: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft")
    time_range_start: Mapped[datetime | None] = mapped_column()
    time_range_end: Mapped[datetime | None] = mapped_column()
    data_sources_used: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    feishu_doc_token: Mapped[str | None] = mapped_column(String(256))
    feishu_doc_url: Mapped[str | None] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
