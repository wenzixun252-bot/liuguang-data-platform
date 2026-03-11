"""add kg_profiles table and simplify entity/relation types

Revision ID: z6p7q8r9s0t1
Revises: afb981d9d787
Create Date: 2026-03-10 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "z6p7q8r9s0t1"
down_revision: Union[str, None] = "afb981d9d787"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 创建 kg_profiles 表
    op.create_table(
        "kg_profiles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("user_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("user_role", sa.String(128), nullable=False, server_default=""),
        sa.Column("user_department", sa.String(128), nullable=False, server_default=""),
        sa.Column("user_description", sa.Text(), nullable=False, server_default=""),
        sa.Column("focus_people", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("focus_projects", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("data_sources", postgresql.JSONB(), nullable=False, server_default='["document","meeting","chat"]'),
        sa.Column("time_range_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id"),
    )
    op.create_index("ix_kg_profiles_owner_id", "kg_profiles", ["owner_id"])

    # 2. 先删除旧约束，再更新数据，最后创建新约束
    op.drop_constraint("ck_kg_entity_type", "kg_entities", type_="check")
    op.execute("UPDATE kg_entities SET entity_type = 'item' WHERE entity_type IN ('project', 'topic', 'organization', 'event')")
    op.create_check_constraint(
        "ck_kg_entity_type",
        "kg_entities",
        "entity_type IN ('person', 'item')",
    )

    # 3. 同样先删约束，再更新，再建新约束
    op.drop_constraint("ck_kg_relation_type", "kg_relations", type_="check")
    op.execute("UPDATE kg_relations SET relation_type = 'involved_in' WHERE relation_type IN ('works_on', 'discusses')")
    op.execute("UPDATE kg_relations SET relation_type = 'related_to' WHERE relation_type = 'belongs_to'")
    op.create_check_constraint(
        "ck_kg_relation_type",
        "kg_relations",
        "relation_type IN ('collaborates_with', 'involved_in', 'related_to')",
    )


def downgrade() -> None:
    # 恢复关系类型约束
    op.drop_constraint("ck_kg_relation_type", "kg_relations", type_="check")
    op.create_check_constraint(
        "ck_kg_relation_type",
        "kg_relations",
        "relation_type IN ('collaborates_with', 'works_on', 'discusses', 'belongs_to', 'related_to')",
    )

    # 恢复实体类型约束
    op.drop_constraint("ck_kg_entity_type", "kg_entities", type_="check")
    op.create_check_constraint(
        "ck_kg_entity_type",
        "kg_entities",
        "entity_type IN ('person', 'project', 'topic', 'organization', 'event')",
    )

    # 删除 kg_profiles 表
    op.drop_index("ix_kg_profiles_owner_id", table_name="kg_profiles")
    op.drop_table("kg_profiles")
