"""add_file_path_to_structured_tables

Revision ID: 76dd7a0179bf
Revises: 616945c99bfb
Create Date: 2026-03-11 13:57:22.634541
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '76dd7a0179bf'
down_revision: Union[str, None] = '616945c99bfb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('structured_tables', sa.Column('file_path', sa.String(1024), nullable=True))


def downgrade() -> None:
    op.drop_column('structured_tables', 'file_path')
