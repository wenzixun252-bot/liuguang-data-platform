"""add original_filename to documents

Revision ID: y5o6p7q8r9s0
Revises: x4n5o6p7q8r9
Create Date: 2026-03-10 17:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "y5o6p7q8r9s0"
down_revision: Union[str, None] = "x4n5o6p7q8r9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("original_filename", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "original_filename")
