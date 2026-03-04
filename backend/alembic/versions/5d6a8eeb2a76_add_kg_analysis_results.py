"""add_kg_analysis_results

Revision ID: 5d6a8eeb2a76
Revises: 37ae6f150bd6
Create Date: 2026-03-04 10:56:54.765726
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '5d6a8eeb2a76'
down_revision: Union[str, None] = '37ae6f150bd6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('kg_analysis_results',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('communities', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('insights', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('risks', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('generated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_kg_analysis_generated', 'kg_analysis_results', ['generated_at'], unique=False)
    op.create_index('idx_kg_analysis_owner', 'kg_analysis_results', ['owner_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_kg_analysis_owner', table_name='kg_analysis_results')
    op.drop_index('idx_kg_analysis_generated', table_name='kg_analysis_results')
    op.drop_table('kg_analysis_results')
