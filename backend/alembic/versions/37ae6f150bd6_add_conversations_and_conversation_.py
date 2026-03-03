"""add conversations and conversation_messages tables

Revision ID: 37ae6f150bd6
Revises: j0e1f2g3h4i5
Create Date: 2026-03-03 17:51:55.585443
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '37ae6f150bd6'
down_revision: Union[str, None] = 'j0e1f2g3h4i5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('conversations',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=256), server_default='新对话', nullable=False),
    sa.Column('scene', sa.String(length=16), server_default='chat', nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_conversations_owner', 'conversations', ['owner_id'], unique=False)
    op.create_table('conversation_messages',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('sources', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('attachments', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_conv_messages_conv_id', 'conversation_messages', ['conversation_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_conv_messages_conv_id', table_name='conversation_messages')
    op.drop_table('conversation_messages')
    op.drop_index('idx_conversations_owner', table_name='conversations')
    op.drop_table('conversations')
