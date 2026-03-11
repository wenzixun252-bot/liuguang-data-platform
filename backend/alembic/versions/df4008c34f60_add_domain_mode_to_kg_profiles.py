"""add_domain_mode_to_kg_profiles

Revision ID: df4008c34f60
Revises: z6p7q8r9s0t1
Create Date: 2026-03-11 09:53:44.883844
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'df4008c34f60'
down_revision: Union[str, None] = 'z6p7q8r9s0t1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('kg_profiles', sa.Column('domain_mode', sa.String(length=32), server_default='function', nullable=False))
    op.add_column('kg_profiles', sa.Column('custom_domains', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))


def downgrade() -> None:
    op.drop_column('kg_profiles', 'custom_domains')
    op.drop_column('kg_profiles', 'domain_mode')
