"""schema_v2_unified_fields

四表统一 Schema 改造：
- Document: 删除 tags/category，新增统一字段
- Meeting: 新增 summary/transcript/recording_url + 统一字段
- ChatMessage: 新增 chat_type/chat_name/summary + 统一字段
- StructuredTable: 新增 content_text/content_vector + 统一字段
- 新增 content_chunks 分块表

统一新增字段: source_platform, source_url, keywords, involved_people,
sentiment, quality_score, duplicate_of, content_hash, parse_status

Revision ID: q7g8h9i0j1k2
Revises: p6f7g8h9i0j1
Create Date: 2026-03-05 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "q7g8h9i0j1k2"
down_revision: Union[str, None] = "p6f7g8h9i0j1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── documents 表 ──────────────────────────────────
    # 删除旧字段
    op.drop_index("idx_doc_tags", table_name="documents")
    op.drop_column("documents", "tags")
    op.drop_column("documents", "category")

    # 新增统一字段
    op.add_column("documents", sa.Column("source_platform", sa.String(32), nullable=True))
    op.add_column("documents", sa.Column("source_url", sa.String(1024), nullable=True))
    op.add_column("documents", sa.Column("keywords", JSONB, nullable=False, server_default="[]"))
    op.add_column("documents", sa.Column("involved_people", JSONB, nullable=False, server_default="[]"))
    op.add_column("documents", sa.Column("sentiment", sa.String(16), nullable=True))
    op.add_column("documents", sa.Column("quality_score", sa.Float, nullable=True))
    op.add_column("documents", sa.Column("duplicate_of", sa.Integer, nullable=True))
    op.add_column("documents", sa.Column("content_hash", sa.String(64), nullable=True))

    op.create_index("idx_doc_keywords", "documents", ["keywords"], postgresql_using="gin")
    op.create_index("idx_doc_content_hash", "documents", ["content_hash"])
    op.create_check_constraint(
        "ck_documents_sentiment",
        "documents",
        "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
    )

    # ── meetings 表 ──────────────────────────────────
    op.add_column("meetings", sa.Column("source_platform", sa.String(32), nullable=True))
    op.add_column("meetings", sa.Column("summary", sa.Text, nullable=True))
    op.add_column("meetings", sa.Column("transcript", sa.Text, nullable=True))
    op.add_column("meetings", sa.Column("recording_url", sa.String(1024), nullable=True))
    op.add_column("meetings", sa.Column("source_url", sa.String(1024), nullable=True))
    op.add_column("meetings", sa.Column("keywords", JSONB, nullable=False, server_default="[]"))
    op.add_column("meetings", sa.Column("involved_people", JSONB, nullable=False, server_default="[]"))
    op.add_column("meetings", sa.Column("sentiment", sa.String(16), nullable=True))
    op.add_column("meetings", sa.Column("quality_score", sa.Float, nullable=True))
    op.add_column("meetings", sa.Column("duplicate_of", sa.Integer, nullable=True))
    op.add_column("meetings", sa.Column("content_hash", sa.String(64), nullable=True))
    op.add_column("meetings", sa.Column("parse_status", sa.String(16), nullable=False, server_default="done"))

    op.create_index("idx_meeting_keywords", "meetings", ["keywords"], postgresql_using="gin")
    op.create_index("idx_meeting_content_hash", "meetings", ["content_hash"])
    op.create_check_constraint(
        "ck_meetings_parse_status",
        "meetings",
        "parse_status IS NULL OR parse_status IN ('pending', 'processing', 'done', 'failed')",
    )
    op.create_check_constraint(
        "ck_meetings_sentiment",
        "meetings",
        "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
    )

    # ── chat_messages 表 ──────────────────────────────
    op.add_column("chat_messages", sa.Column("source_platform", sa.String(32), nullable=True))
    op.add_column("chat_messages", sa.Column("chat_type", sa.String(16), nullable=True))
    op.add_column("chat_messages", sa.Column("chat_name", sa.String(256), nullable=True))
    op.add_column("chat_messages", sa.Column("summary", sa.Text, nullable=True))
    op.add_column("chat_messages", sa.Column("source_url", sa.String(1024), nullable=True))
    op.add_column("chat_messages", sa.Column("keywords", JSONB, nullable=False, server_default="[]"))
    op.add_column("chat_messages", sa.Column("involved_people", JSONB, nullable=False, server_default="[]"))
    op.add_column("chat_messages", sa.Column("sentiment", sa.String(16), nullable=True))
    op.add_column("chat_messages", sa.Column("quality_score", sa.Float, nullable=True))
    op.add_column("chat_messages", sa.Column("duplicate_of", sa.Integer, nullable=True))
    op.add_column("chat_messages", sa.Column("content_hash", sa.String(64), nullable=True))
    op.add_column("chat_messages", sa.Column("parse_status", sa.String(16), nullable=False, server_default="done"))

    op.create_index("idx_chat_keywords", "chat_messages", ["keywords"], postgresql_using="gin")
    op.create_index("idx_chat_content_hash", "chat_messages", ["content_hash"])
    op.create_check_constraint(
        "ck_chat_messages_parse_status",
        "chat_messages",
        "parse_status IS NULL OR parse_status IN ('pending', 'processing', 'done', 'failed')",
    )
    op.create_check_constraint(
        "ck_chat_messages_sentiment",
        "chat_messages",
        "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
    )
    op.create_check_constraint(
        "ck_chat_messages_chat_type",
        "chat_messages",
        "chat_type IS NULL OR chat_type IN ('group', 'private')",
    )

    # ── structured_tables 表 ──────────────────────────
    op.add_column("structured_tables", sa.Column("source_platform", sa.String(32), nullable=True))
    op.add_column("structured_tables", sa.Column("feishu_record_id", sa.String(128), nullable=True))
    op.add_column("structured_tables", sa.Column("content_text", sa.Text, nullable=True))
    # content_vector 需要用 raw SQL 因为 pgvector 类型
    op.execute("ALTER TABLE structured_tables ADD COLUMN content_vector vector(1024)")
    op.add_column("structured_tables", sa.Column("keywords", JSONB, nullable=False, server_default="[]"))
    op.add_column("structured_tables", sa.Column("involved_people", JSONB, nullable=False, server_default="[]"))
    op.add_column("structured_tables", sa.Column("sentiment", sa.String(16), nullable=True))
    op.add_column("structured_tables", sa.Column("quality_score", sa.Float, nullable=True))
    op.add_column("structured_tables", sa.Column("duplicate_of", sa.Integer, nullable=True))
    op.add_column("structured_tables", sa.Column("content_hash", sa.String(64), nullable=True))
    op.add_column("structured_tables", sa.Column("extra_fields", JSONB, nullable=False, server_default="{}"))
    op.add_column("structured_tables", sa.Column("parse_status", sa.String(16), nullable=False, server_default="done"))

    op.create_index("idx_str_table_keywords", "structured_tables", ["keywords"], postgresql_using="gin")
    op.create_index("idx_str_table_content_hash", "structured_tables", ["content_hash"])
    op.create_check_constraint(
        "ck_structured_table_parse_status",
        "structured_tables",
        "parse_status IS NULL OR parse_status IN ('pending', 'processing', 'done', 'failed')",
    )
    op.create_check_constraint(
        "ck_structured_table_sentiment",
        "structured_tables",
        "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
    )

    # ── 新增 content_chunks 表 ─────────────────────────
    op.create_table(
        "content_chunks",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("content_id", sa.Integer, nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("chunk_text", sa.Text, nullable=False),
        sa.Column("token_count", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    # chunk_vector 需要用 raw SQL
    op.execute("ALTER TABLE content_chunks ADD COLUMN chunk_vector vector(1024)")
    op.create_index("idx_chunk_content", "content_chunks", ["content_type", "content_id"])


def downgrade() -> None:
    # content_chunks
    op.drop_table("content_chunks")

    # structured_tables
    op.drop_constraint("ck_structured_table_sentiment", "structured_tables", type_="check")
    op.drop_constraint("ck_structured_table_parse_status", "structured_tables", type_="check")
    op.drop_index("idx_str_table_content_hash", table_name="structured_tables")
    op.drop_index("idx_str_table_keywords", table_name="structured_tables")
    op.drop_column("structured_tables", "parse_status")
    op.drop_column("structured_tables", "extra_fields")
    op.drop_column("structured_tables", "content_hash")
    op.drop_column("structured_tables", "duplicate_of")
    op.drop_column("structured_tables", "quality_score")
    op.drop_column("structured_tables", "sentiment")
    op.drop_column("structured_tables", "involved_people")
    op.drop_column("structured_tables", "keywords")
    op.drop_column("structured_tables", "content_vector")
    op.drop_column("structured_tables", "content_text")
    op.drop_column("structured_tables", "feishu_record_id")
    op.drop_column("structured_tables", "source_platform")

    # chat_messages
    op.drop_constraint("ck_chat_messages_chat_type", "chat_messages", type_="check")
    op.drop_constraint("ck_chat_messages_sentiment", "chat_messages", type_="check")
    op.drop_constraint("ck_chat_messages_parse_status", "chat_messages", type_="check")
    op.drop_index("idx_chat_content_hash", table_name="chat_messages")
    op.drop_index("idx_chat_keywords", table_name="chat_messages")
    op.drop_column("chat_messages", "parse_status")
    op.drop_column("chat_messages", "content_hash")
    op.drop_column("chat_messages", "duplicate_of")
    op.drop_column("chat_messages", "quality_score")
    op.drop_column("chat_messages", "sentiment")
    op.drop_column("chat_messages", "involved_people")
    op.drop_column("chat_messages", "keywords")
    op.drop_column("chat_messages", "source_url")
    op.drop_column("chat_messages", "summary")
    op.drop_column("chat_messages", "chat_name")
    op.drop_column("chat_messages", "chat_type")
    op.drop_column("chat_messages", "source_platform")

    # meetings
    op.drop_constraint("ck_meetings_sentiment", "meetings", type_="check")
    op.drop_constraint("ck_meetings_parse_status", "meetings", type_="check")
    op.drop_index("idx_meeting_content_hash", table_name="meetings")
    op.drop_index("idx_meeting_keywords", table_name="meetings")
    op.drop_column("meetings", "parse_status")
    op.drop_column("meetings", "content_hash")
    op.drop_column("meetings", "duplicate_of")
    op.drop_column("meetings", "quality_score")
    op.drop_column("meetings", "sentiment")
    op.drop_column("meetings", "involved_people")
    op.drop_column("meetings", "keywords")
    op.drop_column("meetings", "source_url")
    op.drop_column("meetings", "recording_url")
    op.drop_column("meetings", "transcript")
    op.drop_column("meetings", "summary")
    op.drop_column("meetings", "source_platform")

    # documents
    op.drop_constraint("ck_documents_sentiment", "documents", type_="check")
    op.drop_index("idx_doc_content_hash", table_name="documents")
    op.drop_index("idx_doc_keywords", table_name="documents")
    op.drop_column("documents", "content_hash")
    op.drop_column("documents", "duplicate_of")
    op.drop_column("documents", "quality_score")
    op.drop_column("documents", "sentiment")
    op.drop_column("documents", "involved_people")
    op.drop_column("documents", "keywords")
    op.drop_column("documents", "source_url")
    op.drop_column("documents", "source_platform")

    # 恢复旧字段
    op.add_column("documents", sa.Column("tags", JSONB, nullable=False, server_default="{}"))
    op.add_column("documents", sa.Column("category", sa.String(128), nullable=True))
    op.create_index("idx_doc_tags", "documents", ["tags"], postgresql_using="gin")
