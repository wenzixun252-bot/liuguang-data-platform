"""add_unified_content_view

Revision ID: l2b3c4d5e6f7
Revises: k1a2b3c4d5e6
Create Date: 2026-03-04 20:10:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'l2b3c4d5e6f7'
down_revision: Union[str, None] = 'k1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Skipped: unified_content view will be created by later migration
    # (afb981d9d787) after communications table exists
    pass


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS unified_content")
