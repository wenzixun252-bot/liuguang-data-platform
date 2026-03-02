"""add url and uploader fields

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-02-28 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # documents
    op.add_column("documents", sa.Column("doc_url", sa.String(1024), nullable=True))
    op.add_column("documents", sa.Column("uploader_name", sa.String(256), nullable=True))

    # meetings
    op.add_column("meetings", sa.Column("minutes_url", sa.String(1024), nullable=True))
    op.add_column("meetings", sa.Column("uploader_name", sa.String(256), nullable=True))

    # chat_messages
    op.add_column("chat_messages", sa.Column("uploader_name", sa.String(256), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "uploader_name")
    op.drop_column("meetings", "uploader_name")
    op.drop_column("meetings", "minutes_url")
    op.drop_column("documents", "uploader_name")
    op.drop_column("documents", "doc_url")
