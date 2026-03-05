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
    op.execute("""
        CREATE OR REPLACE VIEW unified_content AS
          SELECT id, 'document' AS content_type, owner_id, title,
                 LEFT(content_text, 500) AS content_text, created_at, updated_at
          FROM documents
          UNION ALL
          SELECT id, 'meeting' AS content_type, owner_id, title,
                 LEFT(content_text, 500) AS content_text, created_at, updated_at
          FROM meetings
          UNION ALL
          SELECT id, 'chat_message' AS content_type, owner_id, NULL AS title,
                 LEFT(content_text, 500) AS content_text, created_at, updated_at
          FROM chat_messages
          UNION ALL
          SELECT id, 'structured_table' AS content_type, owner_id, name AS title,
                 COALESCE(summary, '') AS content_text,
                 created_at, updated_at
          FROM structured_tables
          WHERE summary IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS unified_content")
