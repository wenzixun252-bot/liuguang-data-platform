"""todo: remove pending_review, add confidence and cancelled_at

Revision ID: 28cef6f4fa01
Revises: c9s0t1u2v3w4
Create Date: 2026-03-18 10:44:52.862967
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '28cef6f4fa01'
down_revision: Union[str, None] = 'c9s0t1u2v3w4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 新增字段
    op.add_column('todo_items', sa.Column('confidence', sa.Float(), nullable=True))
    op.add_column('todo_items', sa.Column('cancelled_at', sa.DateTime(), nullable=True))

    # 2. 先删除旧约束，才能写入新状态值
    op.drop_constraint('ck_todo_status', 'todo_items')

    # 3. 数据迁移：旧状态转换为新状态
    op.execute("UPDATE todo_items SET status = 'in_progress' WHERE status = 'pending_review'")
    op.execute("UPDATE todo_items SET status = 'cancelled', cancelled_at = NOW() WHERE status = 'dismissed'")

    # 4. 创建新约束
    op.create_check_constraint('ck_todo_status', 'todo_items', "status IN ('in_progress', 'completed', 'cancelled')")

    # 5. 修改 server_default
    op.alter_column('todo_items', 'status', server_default='in_progress')


def downgrade() -> None:
    # 恢复 server_default
    op.alter_column('todo_items', 'status', server_default='pending_review')

    # 恢复 CheckConstraint
    op.drop_constraint('ck_todo_status', 'todo_items')
    op.create_check_constraint('ck_todo_status', 'todo_items', "status IN ('pending_review', 'in_progress', 'dismissed', 'completed')")

    # 恢复数据
    op.execute("UPDATE todo_items SET status = 'pending_review' WHERE status = 'in_progress' AND pushed_at IS NULL AND feishu_task_id IS NULL")
    op.execute("UPDATE todo_items SET status = 'dismissed' WHERE status = 'cancelled'")

    # 删除新增字段
    op.drop_column('todo_items', 'cancelled_at')
    op.drop_column('todo_items', 'confidence')
