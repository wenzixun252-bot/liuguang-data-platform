"""add todo_items table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-01 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "todo_items",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("priority", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=True),
        sa.Column("source_text", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending_review"),
        sa.Column("feishu_task_id", sa.String(128), nullable=True),
        sa.Column("pushed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("priority IN ('low', 'medium', 'high')", name="ck_todo_priority"),
        sa.CheckConstraint("source_type IN ('meeting', 'chat_message')", name="ck_todo_source_type"),
        sa.CheckConstraint("status IN ('pending_review', 'confirmed', 'pushed', 'dismissed')", name="ck_todo_status"),
    )
    op.create_index("idx_todo_owner", "todo_items", ["owner_id"])
    op.create_index("idx_todo_status", "todo_items", ["status"])


def downgrade() -> None:
    op.drop_index("idx_todo_status", table_name="todo_items")
    op.drop_index("idx_todo_owner", table_name="todo_items")
    op.drop_table("todo_items")
