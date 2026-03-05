"""add_parse_status_to_documents

Revision ID: o5e6f7g8h9i0
Revises: n4d5e6f7g8h9
Create Date: 2026-03-05 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'o5e6f7g8h9i0'
down_revision: Union[str, None] = 'n4d5e6f7g8h9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'documents',
        sa.Column('parse_status', sa.String(16), nullable=False, server_default='done'),
    )
    op.create_check_constraint(
        'ck_documents_parse_status',
        'documents',
        "parse_status IN ('pending', 'processing', 'done', 'failed')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_documents_parse_status', 'documents', type_='check')
    op.drop_column('documents', 'parse_status')
