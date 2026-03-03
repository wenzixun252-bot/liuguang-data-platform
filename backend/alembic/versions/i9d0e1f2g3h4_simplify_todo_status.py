"""simplify todo status: confirmed/pushed -> in_progress

Revision ID: i9d0e1f2g3h4
Revises: h8c9d0e1f2g3
Create Date: 2026-03-03 10:00:00.000000
"""

from alembic import op

revision = "i9d0e1f2g3h4"
down_revision = "h8c9d0e1f2g3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 先删旧 CHECK 约束（否则 UPDATE 会被拒绝）
    op.drop_constraint("ck_todo_status", "todo_items", type_="check")

    # 2. 将 confirmed 和 pushed 状态迁移为 in_progress
    op.execute("UPDATE todo_items SET status = 'in_progress' WHERE status IN ('confirmed', 'pushed')")

    # 3. 创建新的 CHECK 约束
    op.create_check_constraint(
        "ck_todo_status",
        "todo_items",
        "status IN ('pending_review', 'in_progress', 'dismissed', 'completed')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_todo_status", "todo_items", type_="check")
    op.create_check_constraint(
        "ck_todo_status",
        "todo_items",
        "status IN ('pending_review', 'confirmed', 'pushed', 'dismissed', 'completed')",
    )
