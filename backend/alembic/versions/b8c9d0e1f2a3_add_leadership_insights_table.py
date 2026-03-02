"""add leadership_insights table

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-03-01 10:03:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "leadership_insights",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("analyst_user_id", sa.String(64), nullable=False),
        sa.Column("target_user_id", sa.String(64), nullable=False),
        sa.Column("target_user_name", sa.String(128), nullable=False),
        sa.Column("report_markdown", sa.Text(), nullable=True),
        sa.Column("dimensions", JSONB(), nullable=False, server_default="{}"),
        sa.Column("data_coverage", JSONB(), nullable=False, server_default="{}"),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_insight_analyst", "leadership_insights", ["analyst_user_id"])
    op.create_index("idx_insight_target", "leadership_insights", ["target_user_id"])


def downgrade() -> None:
    op.drop_index("idx_insight_target", table_name="leadership_insights")
    op.drop_index("idx_insight_analyst", table_name="leadership_insights")
    op.drop_table("leadership_insights")
