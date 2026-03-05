"""add_include_shared

Revision ID: m3c4d5e6f7g8
Revises: 9de22062a007
Create Date: 2026-03-05 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'm3c4d5e6f7g8'
down_revision: Union[str, None] = '9de22062a007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('etl_data_sources', sa.Column('include_shared', sa.Boolean(), nullable=False, server_default='true'))
    op.add_column('cloud_folder_sources', sa.Column('include_shared', sa.Boolean(), nullable=False, server_default='true'))
    op.add_column('keyword_sync_rules', sa.Column('include_shared', sa.Boolean(), nullable=False, server_default='true'))


def downgrade() -> None:
    op.drop_column('keyword_sync_rules', 'include_shared')
    op.drop_column('cloud_folder_sources', 'include_shared')
    op.drop_column('etl_data_sources', 'include_shared')
