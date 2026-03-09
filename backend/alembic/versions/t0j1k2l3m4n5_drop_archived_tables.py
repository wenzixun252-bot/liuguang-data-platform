"""drop_archived_tables

清理旧表：DROP _archived_meetings 和 _archived_chat_messages。

Revision ID: t0j1k2l3m4n5
Revises: s9i0j1k2l3m4
Create Date: 2026-03-09
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "t0j1k2l3m4n5"
down_revision = "s9i0j1k2l3m4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("_archived_chat_messages")
    op.drop_table("_archived_meetings")


def downgrade() -> None:
    # 旧表数据已迁移到 communications，无法自动恢复原始表结构。
    # 如需回退，请先 downgrade 到 s9i0j1k2l3m4（会恢复重命名的旧表）。
    pass
