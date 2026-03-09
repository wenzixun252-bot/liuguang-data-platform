"""asset_type_restructure

数据资产分类重构：
- 新建 communications 表（合并 meetings + chat_messages）
- documents 新增 doc_category 字段
- structured_tables 新增 table_category 字段
- 迁移关联表数据（content_tags, content_chunks, content_entity_links）
- 更新 etl_data_sources asset_type
- 旧表重命名保留（后续清理迁移再 DROP）

Revision ID: s9i0j1k2l3m4
Revises: r8h9i0j1k2l3
Create Date: 2026-03-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from pgvector.sqlalchemy import Vector

# revision identifiers, used by Alembic.
revision = "s9i0j1k2l3m4"
down_revision = "r8h9i0j1k2l3"
branch_labels = None
depends_on = None

EMBEDDING_DIM = 1536


def upgrade() -> None:
    # ── 1. 创建 communications 表 ──────────────────────────
    op.create_table(
        "communications",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("comm_type", sa.String(16), nullable=False),
        sa.Column("source_platform", sa.String(32)),
        sa.Column("source_app_token", sa.String(128), nullable=False),
        sa.Column("source_table_id", sa.String(128)),
        sa.Column("feishu_record_id", sa.String(128), nullable=False, unique=True),
        # 合并字段
        sa.Column("title", sa.String(512)),
        sa.Column("comm_time", sa.DateTime),
        sa.Column("initiator", sa.String(256)),
        sa.Column("participants", JSONB, nullable=False, server_default="[]"),
        # 会议独有
        sa.Column("duration_minutes", sa.Integer),
        sa.Column("location", sa.String(512)),
        sa.Column("agenda", sa.Text),
        sa.Column("conclusions", sa.Text),
        sa.Column("action_items", JSONB, nullable=False, server_default="[]"),
        sa.Column("transcript", sa.Text),
        sa.Column("recording_url", sa.String(1024)),
        # 会话独有
        sa.Column("chat_id", sa.String(256)),
        sa.Column("chat_type", sa.String(16)),
        sa.Column("chat_name", sa.String(256)),
        sa.Column("message_type", sa.String(64)),
        sa.Column("reply_to", sa.String(128)),
        # 通用内容
        sa.Column("content_text", sa.Text, nullable=False),
        sa.Column("summary", sa.Text),
        sa.Column("source_url", sa.String(1024)),
        sa.Column("uploader_name", sa.String(256)),
        sa.Column("content_vector", Vector(EMBEDDING_DIM)),
        # LLM 提取
        sa.Column("keywords", JSONB, nullable=False, server_default="[]"),
        sa.Column("sentiment", sa.String(16)),
        # 数据质量
        sa.Column("quality_score", sa.Float),
        sa.Column("duplicate_of", sa.Integer),
        sa.Column("content_hash", sa.String(64)),
        # 通用
        sa.Column("extra_fields", JSONB, nullable=False, server_default="{}"),
        sa.Column("feishu_created_at", sa.DateTime),
        sa.Column("feishu_updated_at", sa.DateTime),
        sa.Column("parse_status", sa.String(16), nullable=False, server_default="done"),
        sa.Column("processed_at", sa.DateTime),
        sa.Column("synced_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        # CHECK 约束
        sa.CheckConstraint("comm_type IN ('meeting', 'chat', 'recording')", name="ck_communications_comm_type"),
        sa.CheckConstraint(
            "parse_status IS NULL OR parse_status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_communications_parse_status",
        ),
        sa.CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_communications_sentiment",
        ),
        sa.CheckConstraint(
            "chat_type IS NULL OR chat_type IN ('group', 'private')",
            name="ck_communications_chat_type",
        ),
    )

    # 索引
    op.create_index("idx_comm_owner", "communications", ["owner_id"])
    op.create_index("idx_comm_type", "communications", ["comm_type"])
    op.create_index("idx_comm_time", "communications", ["comm_time"])
    op.create_index("idx_comm_keywords", "communications", ["keywords"], postgresql_using="gin")
    op.create_index("idx_comm_content_hash", "communications", ["content_hash"])
    op.create_index("idx_comm_chat_id", "communications", ["chat_id"])

    # ── 2. 从 meetings 迁移数据 ──────────────────────────
    op.execute("""
        INSERT INTO communications (
            owner_id, comm_type, source_platform, source_app_token, source_table_id,
            feishu_record_id, title, comm_time, initiator, participants,
            duration_minutes, location, agenda, conclusions, action_items,
            transcript, recording_url,
            content_text, summary, source_url, uploader_name, content_vector,
            keywords, sentiment, quality_score, duplicate_of, content_hash,
            extra_fields, feishu_created_at, feishu_updated_at,
            parse_status, processed_at, synced_at, created_at, updated_at
        )
        SELECT
            owner_id, 'meeting', source_platform, source_app_token, source_table_id,
            feishu_record_id, title, meeting_time, organizer, participants,
            duration_minutes, location, agenda, conclusions, action_items,
            transcript, recording_url,
            content_text, summary, source_url, uploader_name, content_vector,
            keywords, sentiment, quality_score, duplicate_of, content_hash,
            extra_fields, feishu_created_at, feishu_updated_at,
            parse_status, processed_at, synced_at, created_at, updated_at
        FROM meetings
    """)

    # ── 3. 从 chat_messages 迁移数据 ──────────────────────
    op.execute("""
        INSERT INTO communications (
            owner_id, comm_type, source_platform, source_app_token, source_table_id,
            feishu_record_id, title, comm_time, initiator, participants,
            chat_id, chat_type, chat_name, message_type, reply_to,
            content_text, summary, source_url, uploader_name, content_vector,
            keywords, sentiment, quality_score, duplicate_of, content_hash,
            extra_fields,
            parse_status, processed_at, synced_at, created_at, updated_at
        )
        SELECT
            owner_id, 'chat', source_platform, source_app_token, source_table_id,
            feishu_record_id, NULL, sent_at, sender, mentions,
            chat_id, chat_type, chat_name, message_type, reply_to,
            content_text, summary, source_url, uploader_name, content_vector,
            keywords, sentiment, quality_score, duplicate_of, content_hash,
            extra_fields,
            parse_status, processed_at, synced_at, created_at, updated_at
        FROM chat_messages
    """)

    # ── 4. 迁移 content_tags 关联 ─────────────────────────
    # meeting -> communication（通过 feishu_record_id 映射新 ID）
    op.execute("""
        UPDATE content_tags ct
        SET content_type = 'communication',
            content_id = c.id
        FROM communications c
        JOIN meetings m ON m.feishu_record_id = c.feishu_record_id
        WHERE ct.content_type = 'meeting'
          AND ct.content_id = m.id
          AND c.comm_type = 'meeting'
    """)

    # chat_message -> communication
    op.execute("""
        UPDATE content_tags ct
        SET content_type = 'communication',
            content_id = c.id
        FROM communications c
        JOIN chat_messages cm ON cm.feishu_record_id = c.feishu_record_id
        WHERE ct.content_type = 'chat_message'
          AND ct.content_id = cm.id
          AND c.comm_type = 'chat'
    """)

    # ── 5. 迁移 content_chunks 关联 ───────────────────────
    op.execute("""
        UPDATE content_chunks cc
        SET content_type = 'communication',
            content_id = c.id
        FROM communications c
        JOIN meetings m ON m.feishu_record_id = c.feishu_record_id
        WHERE cc.content_type = 'meeting'
          AND cc.content_id = m.id
          AND c.comm_type = 'meeting'
    """)

    op.execute("""
        UPDATE content_chunks cc
        SET content_type = 'communication',
            content_id = c.id
        FROM communications c
        JOIN chat_messages cm ON cm.feishu_record_id = c.feishu_record_id
        WHERE cc.content_type = 'chat_message'
          AND cc.content_id = cm.id
          AND c.comm_type = 'chat'
    """)

    # ── 6. 迁移 content_entity_links 关联 ─────────────────
    op.execute("""
        UPDATE content_entity_links cel
        SET content_type = 'communication',
            content_id = c.id
        FROM communications c
        JOIN meetings m ON m.feishu_record_id = c.feishu_record_id
        WHERE cel.content_type = 'meeting'
          AND cel.content_id = m.id
          AND c.comm_type = 'meeting'
    """)

    op.execute("""
        UPDATE content_entity_links cel
        SET content_type = 'communication',
            content_id = c.id
        FROM communications c
        JOIN chat_messages cm ON cm.feishu_record_id = c.feishu_record_id
        WHERE cel.content_type = 'chat_message'
          AND cel.content_id = cm.id
          AND c.comm_type = 'chat'
    """)

    # ── 7. 更新 etl_data_sources ──────────────────────────
    # 先删除旧约束，再更新数据，最后加新约束
    op.drop_constraint("ck_etl_ds_asset_type", "etl_data_sources", type_="check")
    op.execute("""
        UPDATE etl_data_sources
        SET asset_type = 'communication'
        WHERE asset_type IN ('meeting', 'chat_message')
    """)
    op.create_check_constraint(
        "ck_etl_ds_asset_type",
        "etl_data_sources",
        "asset_type IN ('document', 'communication')",
    )

    # ── 8. 更新 content_tags CHECK 约束 ───────────────────
    op.drop_constraint("ck_content_tag_type", "content_tags", type_="check")
    op.create_check_constraint(
        "ck_content_tag_type",
        "content_tags",
        "content_type IN ('document', 'communication', 'structured_table')",
    )

    # ── 9. documents 新增 doc_category ────────────────────
    op.add_column("documents", sa.Column("doc_category", sa.String(32), nullable=True))
    op.create_check_constraint(
        "ck_documents_doc_category",
        "documents",
        "doc_category IS NULL OR doc_category IN ('report', 'proposal', 'policy', 'technical')",
    )
    op.create_index("idx_doc_category", "documents", ["doc_category"])

    # ── 10. structured_tables 新增 table_category ─────────
    op.add_column("structured_tables", sa.Column("table_category", sa.String(64), nullable=True))
    op.create_index("idx_str_table_category", "structured_tables", ["table_category"])

    # ── 11. 旧表重命名保留 ────────────────────────────────
    op.rename_table("meetings", "_archived_meetings")
    op.rename_table("chat_messages", "_archived_chat_messages")


def downgrade() -> None:
    # 恢复旧表名
    op.rename_table("_archived_meetings", "meetings")
    op.rename_table("_archived_chat_messages", "chat_messages")

    # 删除新字段
    op.drop_index("idx_str_table_category", "structured_tables")
    op.drop_column("structured_tables", "table_category")

    op.drop_constraint("ck_documents_doc_category", "documents", type_="check")
    op.drop_index("idx_doc_category", "documents")
    op.drop_column("documents", "doc_category")

    # 恢复 content_tags CHECK
    op.drop_constraint("ck_content_tag_type", "content_tags", type_="check")
    op.create_check_constraint(
        "ck_content_tag_type",
        "content_tags",
        "content_type IN ('document', 'meeting', 'chat_message', 'structured_table')",
    )

    # 恢复 etl_data_sources CHECK
    op.drop_constraint("ck_etl_ds_asset_type", "etl_data_sources", type_="check")
    op.execute("""
        UPDATE etl_data_sources
        SET asset_type = 'meeting'
        WHERE asset_type = 'communication'
    """)
    op.create_check_constraint(
        "ck_etl_ds_asset_type",
        "etl_data_sources",
        "asset_type IN ('document', 'meeting', 'chat_message')",
    )

    # 恢复关联表数据（简化：直接回退 content_type 值）
    op.execute("""
        UPDATE content_tags
        SET content_type = 'meeting'
        WHERE content_type = 'communication'
          AND content_id IN (SELECT id FROM meetings)
    """)
    op.execute("""
        UPDATE content_tags
        SET content_type = 'chat_message'
        WHERE content_type = 'communication'
          AND content_id IN (SELECT id FROM chat_messages)
    """)

    # 删除 communications 表
    op.drop_table("communications")
