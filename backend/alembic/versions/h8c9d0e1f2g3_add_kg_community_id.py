"""add community_id to kg_entities

Revision ID: h8c9d0e1f2g3
Revises: g7b8c9d0e1f2
Create Date: 2026-03-02 20:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "h8c9d0e1f2g3"
down_revision = "g7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kg_entities", sa.Column("community_id", sa.Integer(), nullable=True))
    op.create_index("idx_kg_entity_community", "kg_entities", ["community_id"])


def downgrade() -> None:
    op.drop_index("idx_kg_entity_community", table_name="kg_entities")
    op.drop_column("kg_entities", "community_id")
