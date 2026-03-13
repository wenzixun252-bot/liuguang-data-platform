"""add bot_message_tasks table

Revision ID: b1c2d3e4f5a6
Revises: 954d33874f3b
Create Date: 2026-03-13 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = '954d33874f3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bot_message_tasks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('task_id', sa.String(length=64), nullable=False),
        sa.Column('open_id', sa.String(length=64), nullable=False),
        sa.Column('message_id', sa.String(length=128), nullable=False),
        sa.Column('input_type', sa.String(length=32), nullable=False),
        sa.Column('raw_content', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('selected_asset_type', sa.String(length=32), nullable=True),
        sa.Column('selected_extraction_rule_id', sa.Integer(), nullable=True),
        sa.Column('selected_cleaning_rule_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('result_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_bot_message_tasks_task_id', 'bot_message_tasks', ['task_id'], unique=True)
    op.create_index('ix_bot_message_tasks_open_id', 'bot_message_tasks', ['open_id'], unique=False)
    op.create_index('ix_bot_message_tasks_message_id', 'bot_message_tasks', ['message_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_bot_message_tasks_message_id', table_name='bot_message_tasks')
    op.drop_index('ix_bot_message_tasks_open_id', table_name='bot_message_tasks')
    op.drop_index('ix_bot_message_tasks_task_id', table_name='bot_message_tasks')
    op.drop_table('bot_message_tasks')
