"""extend KG entity_type with community + add report target_readers

Revision ID: g7b8c9d0e1f2
Revises: e1f2a3b4c5d6
Create Date: 2026-03-02 17:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "g7b8c9d0e1f2"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 更新 kg_entities 的 entity_type 约束，增加 community
    op.drop_constraint("ck_kg_entity_type", "kg_entities", type_="check")
    op.create_check_constraint(
        "ck_kg_entity_type",
        "kg_entities",
        "entity_type IN ('person', 'project', 'topic', 'organization', 'event', 'document', 'community')",
    )

    # 2. reports 表增加 target_readers 字段（需求3用）
    op.add_column("reports", sa.Column("target_readers", JSONB, nullable=True, server_default="[]"))

    # 3. todo_items 增加 content_hash 和 completed_at 字段（需求4用）
    op.add_column("todo_items", sa.Column("content_hash", sa.String(64), nullable=True))
    op.add_column("todo_items", sa.Column("completed_at", sa.DateTime, nullable=True))

    # 4. 更新 todo_items 的 status 约束，增加 completed
    op.drop_constraint("ck_todo_status", "todo_items", type_="check")
    op.create_check_constraint(
        "ck_todo_status",
        "todo_items",
        "status IN ('pending_review', 'confirmed', 'pushed', 'dismissed', 'completed')",
    )

    # 5. content_hash 索引（去重用）
    op.create_index("idx_todo_content_hash", "todo_items", ["content_hash"])


def downgrade() -> None:
    op.drop_index("idx_todo_content_hash", table_name="todo_items")

    op.drop_constraint("ck_todo_status", "todo_items", type_="check")
    op.create_check_constraint(
        "ck_todo_status",
        "todo_items",
        "status IN ('pending_review', 'confirmed', 'pushed', 'dismissed')",
    )

    op.drop_column("todo_items", "completed_at")
    op.drop_column("todo_items", "content_hash")
    op.drop_column("reports", "target_readers")

    op.drop_constraint("ck_kg_entity_type", "kg_entities", type_="check")
    op.create_check_constraint(
        "ck_kg_entity_type",
        "kg_entities",
        "entity_type IN ('person', 'project', 'topic', 'organization', 'event', 'document')",
    )
