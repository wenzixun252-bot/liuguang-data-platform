"""update import_task status constraint for cancel and timeout

Revision ID: v2l3m4n5o6p7
Revises: 4ff9b601031c
Create Date: 2026-03-10T09:49:06.482639
"""
from alembic import op

revision = 'v2l3m4n5o6p7'
down_revision = '4ff9b601031c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop old constraint and add new one with cancelled and timeout
    op.drop_constraint('ck_import_task_status', 'import_tasks', type_='check')
    op.create_check_constraint(
        'ck_import_task_status',
        'import_tasks',
        "status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout')"
    )


def downgrade() -> None:
    op.drop_constraint('ck_import_task_status', 'import_tasks', type_='check')
    op.create_check_constraint(
        'ck_import_task_status',
        'import_tasks',
        "status IN ('pending', 'running', 'completed', 'failed')"
    )
