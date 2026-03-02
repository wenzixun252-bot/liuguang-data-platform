"""add report_templates and reports tables

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-01 10:01:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_templates",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("template_type", sa.String(16), nullable=False, server_default="custom"),
        sa.Column("owner_id", sa.String(64), nullable=True),
        sa.Column("prompt_template", sa.Text(), nullable=False),
        sa.Column("output_structure", JSONB(), nullable=False, server_default="{}"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("template_type IN ('system', 'custom')", name="ck_report_tpl_type"),
    )
    op.create_index("idx_report_tpl_owner", "report_templates", ["owner_id"])

    op.create_table(
        "reports",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("report_templates.id"), nullable=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("content_markdown", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("time_range_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("time_range_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("data_sources_used", JSONB(), nullable=False, server_default="{}"),
        sa.Column("feishu_doc_token", sa.String(256), nullable=True),
        sa.Column("feishu_doc_url", sa.String(1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('draft', 'generating', 'completed', 'failed', 'published')",
            name="ck_report_status",
        ),
    )
    op.create_index("idx_report_owner", "reports", ["owner_id"])
    op.create_index("idx_report_status", "reports", ["status"])


def downgrade() -> None:
    op.drop_index("idx_report_status", table_name="reports")
    op.drop_index("idx_report_owner", table_name="reports")
    op.drop_table("reports")
    op.drop_index("idx_report_tpl_owner", table_name="report_templates")
    op.drop_table("report_templates")
