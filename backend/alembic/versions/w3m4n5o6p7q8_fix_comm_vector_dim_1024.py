"""fix communications content_vector dimension from 1536 to 1024

Revision ID: w3m4n5o6p7q8
Revises: v2l3m4n5o6p7
Create Date: 2026-03-10 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "w3m4n5o6p7q8"
down_revision: str = "v2l3m4n5o6p7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # communications 表的 content_vector 在之前的迁移中漏掉了，仍为 1536 维
    # 当前 Embedding 模型 (BAAI/bge-m3) 输出 1024 维，需要对齐
    op.execute("ALTER TABLE communications DROP COLUMN IF EXISTS content_vector")
    op.execute("ALTER TABLE communications ADD COLUMN content_vector vector(1024)")


def downgrade() -> None:
    op.execute("ALTER TABLE communications DROP COLUMN IF EXISTS content_vector")
    op.execute("ALTER TABLE communications ADD COLUMN content_vector vector(1536)")
