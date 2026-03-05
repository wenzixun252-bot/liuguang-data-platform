"""add_tags_and_entity_links

Revision ID: k1a2b3c4d5e6
Revises: 874a264003fd
Create Date: 2026-03-04 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'k1a2b3c4d5e6'
down_revision: Union[str, None] = '874a264003fd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- tag_definitions ---
    op.create_table(
        "tag_definitions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_id", sa.String(64), nullable=True),
        sa.Column("category", sa.String(32), nullable=False, server_default="custom"),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("color", sa.String(16), nullable=False, server_default="#6366f1"),
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "category IN ('project', 'priority', 'topic', 'custom')",
            name="ck_tag_def_category",
        ),
        sa.UniqueConstraint("owner_id", "name", name="uq_tag_def_owner_name"),
    )
    op.create_index("idx_tag_def_owner", "tag_definitions", ["owner_id"])

    # --- content_tags ---
    op.create_table(
        "content_tags",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tag_id", sa.Integer(), sa.ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("content_id", sa.Integer(), nullable=False),
        sa.Column("tagged_by", sa.String(16), nullable=False, server_default="user_manual"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "content_type IN ('document', 'meeting', 'chat_message', 'structured_table')",
            name="ck_content_tag_type",
        ),
        sa.CheckConstraint(
            "tagged_by IN ('user_manual', 'source_inherit', 'ai_suggest')",
            name="ck_content_tag_by",
        ),
        sa.UniqueConstraint("tag_id", "content_type", "content_id", name="uq_content_tag"),
    )
    op.create_index("idx_content_tag_content", "content_tags", ["content_type", "content_id"])
    op.create_index("idx_content_tag_tag", "content_tags", ["tag_id"])

    # --- etl_data_sources.default_tag_ids ---
    op.add_column(
        "etl_data_sources",
        sa.Column("default_tag_ids", sa.JSON(), nullable=False, server_default="[]"),
    )

    # --- content_entity_links ---
    op.create_table(
        "content_entity_links",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("kg_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("content_id", sa.Integer(), nullable=False),
        sa.Column("relation_type", sa.String(32), nullable=False, server_default="mentioned_in"),
        sa.Column("context_snippet", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entity_id", "content_type", "content_id", name="uq_cel"),
    )
    op.create_index("idx_cel_entity", "content_entity_links", ["entity_id"])
    op.create_index("idx_cel_content", "content_entity_links", ["content_type", "content_id"])


def downgrade() -> None:
    op.drop_table("content_entity_links")
    op.drop_column("etl_data_sources", "default_tag_ids")
    op.drop_table("content_tags")
    op.drop_table("tag_definitions")
