"""add source_time to todo_items

Revision ID: a7q8r9s0t1u2
Revises: z6p7q8r9s0t1
Create Date: 2026-03-15 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a7q8r9s0t1u2"
down_revision: Union[str, None] = "z6p7q8r9s0t1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "todo_items",
        sa.Column("source_time", sa.DateTime(), nullable=True, comment="来源内容的时间（聊天发送时间/会议时间）"),
    )


def downgrade() -> None:
    op.drop_column("todo_items", "source_time")
