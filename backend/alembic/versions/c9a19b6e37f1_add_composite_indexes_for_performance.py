"""add composite indexes for performance

Revision ID: c9a19b6e37f1
Revises: ecd7fdd3d731
Create Date: 2026-03-19 09:47:13.975609
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c9a19b6e37f1'
down_revision: Union[str, None] = 'ecd7fdd3d731'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("idx_doc_owner_source", "documents", ["owner_id", "source_type"])
    op.create_index("idx_doc_owner_synced", "documents", ["owner_id", "synced_at"])
    op.create_index("idx_str_table_owner_source", "structured_tables", ["owner_id", "source_type"])
    op.create_index("idx_str_table_owner_synced", "structured_tables", ["owner_id", "synced_at"])


def downgrade() -> None:
    op.drop_index("idx_str_table_owner_synced", table_name="structured_tables")
    op.drop_index("idx_str_table_owner_source", table_name="structured_tables")
    op.drop_index("idx_doc_owner_synced", table_name="documents")
    op.drop_index("idx_doc_owner_source", table_name="documents")
