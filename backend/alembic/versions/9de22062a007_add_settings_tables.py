"""add_settings_tables

Revision ID: 9de22062a007
Revises: l2b3c4d5e6f7
Create Date: 2026-03-05 09:42:07.973479
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9de22062a007'
down_revision: Union[str, None] = 'l2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('keyword_sync_rules',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('keyword', sa.String(length=256), nullable=False),
    sa.Column('is_enabled', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('last_scan_time', sa.DateTime(), nullable=True),
    sa.Column('docs_matched', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_keyword_rule', 'keyword_sync_rules', ['owner_id', 'keyword'], unique=True)
    op.create_table('user_notification_prefs',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('on_sync_completed', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('on_sync_failed', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('on_new_data', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('on_tag_suggestion', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('on_share_received', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('owner_id')
    )


def downgrade() -> None:
    op.drop_table('user_notification_prefs')
    op.drop_index('uq_keyword_rule', table_name='keyword_sync_rules')
    op.drop_table('keyword_sync_rules')
