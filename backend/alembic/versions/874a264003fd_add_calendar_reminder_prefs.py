"""add_calendar_reminder_prefs

Revision ID: 874a264003fd
Revises: 5d6a8eeb2a76
Create Date: 2026-03-04 14:24:28.463740
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '874a264003fd'
down_revision: Union[str, None] = '5d6a8eeb2a76'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('calendar_reminder_prefs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('owner_id', sa.String(length=64), nullable=False),
        sa.Column('enabled', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('minutes_before', sa.Integer(), server_default='30', nullable=False),
        sa.Column('last_reminded_event_id', sa.String(length=256), nullable=True),
        sa.Column('last_reminded_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_id'),
    )
    op.create_index('idx_cal_reminder_owner', 'calendar_reminder_prefs', ['owner_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_cal_reminder_owner', table_name='calendar_reminder_prefs')
    op.drop_table('calendar_reminder_prefs')
