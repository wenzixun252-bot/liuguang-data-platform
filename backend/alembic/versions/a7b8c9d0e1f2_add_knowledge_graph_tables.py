"""add kg_entities and kg_relations tables

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-03-01 10:02:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "a7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kg_entities",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("properties", JSONB(), nullable=False, server_default="{}"),
        sa.Column("mention_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "entity_type IN ('person', 'project', 'topic', 'organization', 'event', 'document')",
            name="ck_kg_entity_type",
        ),
    )
    op.create_index("idx_kg_entity_owner", "kg_entities", ["owner_id"])
    op.create_index("idx_kg_entity_type", "kg_entities", ["entity_type"])
    op.create_index("idx_kg_entity_name", "kg_entities", ["name"])

    op.create_table(
        "kg_relations",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("source_entity_id", sa.Integer(), sa.ForeignKey("kg_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_entity_id", sa.Integer(), sa.ForeignKey("kg_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation_type", sa.String(32), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("evidence_sources", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "relation_type IN ('collaborates_with', 'works_on', 'discusses', 'belongs_to', 'related_to')",
            name="ck_kg_relation_type",
        ),
    )
    op.create_index("idx_kg_rel_owner", "kg_relations", ["owner_id"])
    op.create_index("idx_kg_rel_source", "kg_relations", ["source_entity_id"])
    op.create_index("idx_kg_rel_target", "kg_relations", ["target_entity_id"])


def downgrade() -> None:
    op.drop_index("idx_kg_rel_target", table_name="kg_relations")
    op.drop_index("idx_kg_rel_source", table_name="kg_relations")
    op.drop_index("idx_kg_rel_owner", table_name="kg_relations")
    op.drop_table("kg_relations")
    op.drop_index("idx_kg_entity_name", table_name="kg_entities")
    op.drop_index("idx_kg_entity_type", table_name="kg_entities")
    op.drop_index("idx_kg_entity_owner", table_name="kg_entities")
    op.drop_table("kg_entities")
