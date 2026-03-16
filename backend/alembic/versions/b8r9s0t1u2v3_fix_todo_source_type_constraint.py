"""fix todo_items source_type check constraint to allow 'communication'

Revision ID: b8r9s0t1u2v3
Revises: z6p7q8r9s0t1
Create Date: 2026-03-12 10:00:00.000000
"""
from alembic import op

revision = "b8r9s0t1u2v3"
down_revision = ("z6p7q8r9s0t1", "23d9b40c8e80")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old constraint (which only allows 'meeting', 'chat_message')
    op.drop_constraint("ck_todo_source_type", "todo_items", type_="check")
    # Create new constraint matching the updated model
    op.create_check_constraint(
        "ck_todo_source_type",
        "todo_items",
        "source_type IN ('communication')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_todo_source_type", "todo_items", type_="check")
    op.create_check_constraint(
        "ck_todo_source_type",
        "todo_items",
        "source_type IN ('meeting', 'chat_message')",
    )
