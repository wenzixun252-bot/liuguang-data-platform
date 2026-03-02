"""add user_visibility_overrides table

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-03-02 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_visibility_overrides",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "department_id", name="uq_user_vis_override"),
    )
    op.create_index("idx_uvo_user", "user_visibility_overrides", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_uvo_user", table_name="user_visibility_overrides")
    op.drop_table("user_visibility_overrides")
