"""add extraction and cleaning rules

Revision ID: 616945c99bfb
Revises: df4008c34f60
Create Date: 2026-03-11 13:17:01.738333
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '616945c99bfb'
down_revision: Union[str, None] = 'df4008c34f60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 新建 extraction_rules 表
    op.create_table('extraction_rules',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('sectors', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('fields', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('prompt_hint', sa.Text(), server_default='', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_extraction_rule_owner', 'extraction_rules', ['owner_id'], unique=False)

    # 新建 cleaning_rules 表
    op.create_table('cleaning_rules',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('options', postgresql.JSONB(astext_type=sa.Text()), server_default='{"dedup": true, "drop_empty_rows": true, "empty_threshold": 0.5, "normalize_dates": true, "normalize_numbers": true, "trim_whitespace": true, "llm_field_merge": true, "llm_field_clean": true}', nullable=False),
    sa.Column('field_hint', sa.Text(), server_default='', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_cleaning_rule_owner', 'cleaning_rules', ['owner_id'], unique=False)

    # Document 表新增字段
    op.add_column('documents', sa.Column('key_info', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('documents', sa.Column('extraction_rule_id', sa.Integer(), nullable=True))

    # Communication 表新增字段
    op.add_column('communications', sa.Column('key_info', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('communications', sa.Column('extraction_rule_id', sa.Integer(), nullable=True))

    # StructuredTable 表新增字段
    op.add_column('structured_tables', sa.Column('cleaning_rule_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('structured_tables', 'cleaning_rule_id')
    op.drop_column('communications', 'extraction_rule_id')
    op.drop_column('communications', 'key_info')
    op.drop_column('documents', 'extraction_rule_id')
    op.drop_column('documents', 'key_info')
    op.drop_index('idx_cleaning_rule_owner', table_name='cleaning_rules')
    op.drop_table('cleaning_rules')
    op.drop_index('idx_extraction_rule_owner', table_name='extraction_rules')
    op.drop_table('extraction_rules')
