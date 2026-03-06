"""drop_involved_people_add_processed_at

字段优化：
- 四表删除 involved_people（太宽泛，保留各表专属人物字段）
- Document 删除 doc_url（合并到 source_url）
- Meeting 删除 minutes_url（合并到 source_url）
- 四表新增 processed_at（LLM 处理完成时间）

Revision ID: r8h9i0j1k2l3
Revises: q7g8h9i0j1k2
Create Date: 2026-03-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "r8h9i0j1k2l3"
down_revision = "q7g8h9i0j1k2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- 数据迁移：doc_url -> source_url（仅当 source_url 为空时） --
    op.execute("""
        UPDATE documents
        SET source_url = doc_url
        WHERE doc_url IS NOT NULL AND (source_url IS NULL OR source_url = '')
    """)

    # -- 数据迁移：minutes_url -> source_url（仅当 source_url 为空时） --
    op.execute("""
        UPDATE meetings
        SET source_url = minutes_url
        WHERE minutes_url IS NOT NULL AND (source_url IS NULL OR source_url = '')
    """)

    # -- 删除字段 --
    op.drop_column("documents", "doc_url")
    op.drop_column("documents", "involved_people")
    op.drop_column("meetings", "minutes_url")
    op.drop_column("meetings", "involved_people")
    op.drop_column("chat_messages", "involved_people")
    op.drop_column("structured_tables", "involved_people")

    # -- 新增 processed_at --
    op.add_column("documents", sa.Column("processed_at", sa.DateTime(), nullable=True))
    op.add_column("meetings", sa.Column("processed_at", sa.DateTime(), nullable=True))
    op.add_column("chat_messages", sa.Column("processed_at", sa.DateTime(), nullable=True))
    op.add_column("structured_tables", sa.Column("processed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    # -- 删除 processed_at --
    op.drop_column("structured_tables", "processed_at")
    op.drop_column("chat_messages", "processed_at")
    op.drop_column("meetings", "processed_at")
    op.drop_column("documents", "processed_at")

    # -- 恢复删除的字段 --
    op.add_column("structured_tables", sa.Column("involved_people", JSONB(), server_default="[]", nullable=False))
    op.add_column("chat_messages", sa.Column("involved_people", JSONB(), server_default="[]", nullable=False))
    op.add_column("meetings", sa.Column("involved_people", JSONB(), server_default="[]", nullable=False))
    op.add_column("meetings", sa.Column("minutes_url", sa.String(1024), nullable=True))
    op.add_column("documents", sa.Column("involved_people", JSONB(), server_default="[]", nullable=False))
    op.add_column("documents", sa.Column("doc_url", sa.String(1024), nullable=True))

    # -- 数据回迁：source_url -> doc_url / minutes_url --
    op.execute("""
        UPDATE documents
        SET doc_url = source_url
        WHERE source_url IS NOT NULL AND doc_url IS NULL
    """)
    op.execute("""
        UPDATE meetings
        SET minutes_url = source_url
        WHERE source_url IS NOT NULL AND minutes_url IS NULL
    """)
