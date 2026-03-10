"""add importance_score to kg_entities and update entity_type constraint

Revision ID: x4n5o6p7q8r9
Revises: w3m4n5o6p7q8
Create Date: 2026-03-10 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "x4n5o6p7q8r9"
down_revision: str = "w3m4n5o6p7q8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 添加 importance_score 列
    op.add_column("kg_entities", sa.Column("importance_score", sa.Float(), nullable=False, server_default="0.0"))
    op.create_index("idx_kg_entity_importance", "kg_entities", ["owner_id", "importance_score"])

    # 更新 entity_type 约束：去掉 document 和 community
    op.drop_constraint("ck_kg_entity_type", "kg_entities", type_="check")

    # 先清理已有的 document 和 community 类型实体（将其转为 topic）
    op.execute("UPDATE kg_entities SET entity_type = 'topic' WHERE entity_type IN ('document', 'community')")

    # 然后创建新约束
    op.create_check_constraint(
        "ck_kg_entity_type",
        "kg_entities",
        "entity_type IN ('person', 'project', 'topic', 'organization', 'event')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_kg_entity_type", "kg_entities", type_="check")
    op.create_check_constraint(
        "ck_kg_entity_type",
        "kg_entities",
        "entity_type IN ('person', 'project', 'topic', 'organization', 'event', 'document', 'community')",
    )
    op.drop_index("idx_kg_entity_importance", table_name="kg_entities")
    op.drop_column("kg_entities", "importance_score")
