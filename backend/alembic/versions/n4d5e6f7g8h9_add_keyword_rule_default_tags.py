"""add_keyword_rule_default_tags

Revision ID: n4d5e6f7g8h9
Revises: m3c4d5e6f7g8
Create Date: 2026-03-05 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'n4d5e6f7g8h9'
down_revision: Union[str, None] = 'm3c4d5e6f7g8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('keyword_sync_rules', sa.Column('default_tag_ids', JSONB(), nullable=False, server_default='[]'))


def downgrade() -> None:
    op.drop_column('keyword_sync_rules', 'default_tag_ids')
