"""change vector dimension from 1536 to 1024

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-02-28 15:30:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: str = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop existing vector columns and recreate with 1024 dimensions
    # No data loss: embeddings were never successfully generated (API key was invalid)
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS content_vector")
    op.execute("ALTER TABLE documents ADD COLUMN content_vector vector(1024)")

    op.execute("ALTER TABLE meetings DROP COLUMN IF EXISTS content_vector")
    op.execute("ALTER TABLE meetings ADD COLUMN content_vector vector(1024)")

    op.execute("ALTER TABLE chat_messages DROP COLUMN IF EXISTS content_vector")
    op.execute("ALTER TABLE chat_messages ADD COLUMN content_vector vector(1024)")


def downgrade() -> None:
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS content_vector")
    op.execute("ALTER TABLE documents ADD COLUMN content_vector vector(1536)")

    op.execute("ALTER TABLE meetings DROP COLUMN IF EXISTS content_vector")
    op.execute("ALTER TABLE meetings ADD COLUMN content_vector vector(1536)")

    op.execute("ALTER TABLE chat_messages DROP COLUMN IF EXISTS content_vector")
    op.execute("ALTER TABLE chat_messages ADD COLUMN content_vector vector(1536)")
