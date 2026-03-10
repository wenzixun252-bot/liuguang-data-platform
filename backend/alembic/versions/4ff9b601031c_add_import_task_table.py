"""add_import_task_table

Revision ID: 4ff9b601031c
Revises: u1k2l3m4n5o6
Create Date: 2026-03-10 00:37:04.271376
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '4ff9b601031c'
down_revision: Union[str, None] = 'u1k2l3m4n5o6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('import_tasks',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('task_type', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='pending', nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('total_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('imported_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('skipped_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('failed_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('pending', 'running', 'completed', 'failed')", name='ck_import_task_status'),
    sa.CheckConstraint("task_type IN ('cloud_doc', 'communication', 'folder_sync', 'bitable_sync')", name='ck_import_task_type'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_import_task_owner', 'import_tasks', ['owner_id'], unique=False)
    op.create_index('idx_import_task_status', 'import_tasks', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_import_task_status', table_name='import_tasks')
    op.drop_index('idx_import_task_owner', table_name='import_tasks')
    op.drop_table('import_tasks')