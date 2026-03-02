"""three table refactor: documents, meetings, chat_messages, departments

Revision ID: a1b2c3d4e5f6
Revises: 92851a26d6b0
Create Date: 2026-02-28 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "92851a26d6b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. 创建 documents 表 ──
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("source_type", sa.String(16), nullable=False),
        sa.Column("source_app_token", sa.String(128), nullable=True),
        sa.Column("source_table_id", sa.String(128), nullable=True),
        sa.Column("feishu_record_id", sa.String(128), nullable=True),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("content_text", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("author", sa.String(256), nullable=True),
        sa.Column("tags", JSONB(), nullable=False, server_default="{}"),
        sa.Column("category", sa.String(128), nullable=True),
        sa.Column("file_type", sa.String(64), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("file_path", sa.String(1024), nullable=True),
        sa.Column("extra_fields", JSONB(), nullable=False, server_default="{}"),
        sa.Column("feishu_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feishu_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("source_type IN ('cloud', 'local')", name="ck_documents_source_type"),
    )
    # pgvector 列需要用 raw SQL
    op.execute("ALTER TABLE documents ADD COLUMN content_vector vector(1536)")

    op.create_index("idx_doc_owner", "documents", ["owner_id"])
    op.create_index("idx_doc_source_type", "documents", ["source_type"])
    op.execute(
        "CREATE UNIQUE INDEX idx_doc_feishu_rid ON documents (feishu_record_id) "
        "WHERE feishu_record_id IS NOT NULL"
    )
    op.create_index("idx_doc_tags", "documents", ["tags"], postgresql_using="gin")
    op.create_index("idx_doc_extra", "documents", ["extra_fields"], postgresql_using="gin")

    # ── 2. 创建 meetings 表 ──
    op.create_table(
        "meetings",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("source_app_token", sa.String(128), nullable=False),
        sa.Column("source_table_id", sa.String(128), nullable=True),
        sa.Column("feishu_record_id", sa.String(128), nullable=False, unique=True),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("meeting_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("location", sa.String(512), nullable=True),
        sa.Column("organizer", sa.String(256), nullable=True),
        sa.Column("participants", JSONB(), nullable=False, server_default="[]"),
        sa.Column("agenda", sa.Text(), nullable=True),
        sa.Column("conclusions", sa.Text(), nullable=True),
        sa.Column("action_items", JSONB(), nullable=False, server_default="[]"),
        sa.Column("content_text", sa.Text(), nullable=False),
        sa.Column("extra_fields", JSONB(), nullable=False, server_default="{}"),
        sa.Column("feishu_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feishu_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute("ALTER TABLE meetings ADD COLUMN content_vector vector(1536)")
    op.create_index("idx_meeting_owner", "meetings", ["owner_id"])
    op.create_index("idx_meeting_time", "meetings", ["meeting_time"])

    # ── 3. 创建 chat_messages 表 ──
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("source_app_token", sa.String(128), nullable=False),
        sa.Column("source_table_id", sa.String(128), nullable=True),
        sa.Column("feishu_record_id", sa.String(128), nullable=False, unique=True),
        sa.Column("chat_id", sa.String(256), nullable=True),
        sa.Column("sender", sa.String(256), nullable=True),
        sa.Column("message_type", sa.String(64), nullable=True),
        sa.Column("content_text", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reply_to", sa.String(128), nullable=True),
        sa.Column("mentions", JSONB(), nullable=False, server_default="[]"),
        sa.Column("extra_fields", JSONB(), nullable=False, server_default="{}"),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute("ALTER TABLE chat_messages ADD COLUMN content_vector vector(1536)")
    op.create_index("idx_chat_owner", "chat_messages", ["owner_id"])
    op.create_index("idx_chat_id", "chat_messages", ["chat_id"])
    op.create_index("idx_chat_sent_at", "chat_messages", ["sent_at"])

    # ── 4. 创建 departments 表 ──
    op.create_table(
        "departments",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("feishu_department_id", sa.String(128), nullable=False, unique=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
        sa.Column("feishu_parent_id", sa.String(128), nullable=True),
        sa.Column("order_val", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # ── 5. 创建 user_departments 表 ──
    op.create_table(
        "user_departments",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=False),
        sa.Column("is_manager", sa.Boolean(), nullable=False, server_default="false"),
        sa.UniqueConstraint("user_id", "department_id", name="uq_user_department"),
    )
    op.create_index("idx_ud_user", "user_departments", ["user_id"])
    op.create_index("idx_ud_dept", "user_departments", ["department_id"])

    # ── 6. 迁移 data_assets 数据到 documents ──
    op.execute("""
        INSERT INTO documents (
            owner_id, source_type, source_app_token, source_table_id,
            feishu_record_id, title, content_text, content_vector,
            tags, extra_fields, feishu_created_at, feishu_updated_at,
            synced_at, created_at, updated_at
        )
        SELECT
            owner_id, 'cloud', source_app_token, source_table_id,
            feishu_record_id, title, content_text, content_vector,
            asset_tags, '{}', feishu_created_at, feishu_updated_at,
            synced_at, created_at, updated_at
        FROM data_assets
    """)

    # ── 7. 删除 data_assets 表 ──
    op.drop_table("data_assets")

    # ── 8. 给 etl_data_sources 加 owner_id 列 ──
    op.add_column("etl_data_sources", sa.Column("owner_id", sa.String(64), nullable=True))

    # ── 9. 更新已有 etl_data_sources asset_type 值（先更新再加约束）──
    op.execute("UPDATE etl_data_sources SET asset_type = 'document' WHERE asset_type NOT IN ('document', 'meeting', 'chat_message')")

    # ── 10. 添加 etl_data_sources.asset_type 约束 ──
    op.create_check_constraint(
        "ck_etl_ds_asset_type",
        "etl_data_sources",
        "asset_type IN ('document', 'meeting', 'chat_message')",
    )

    # ── 11. 更新已有 users role 值（先更新再改约束）──
    op.execute("UPDATE users SET role = 'employee' WHERE role = 'executive'")

    # ── 12. 更新 users.role 约束 ──
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", "role IN ('employee', 'admin')")


def downgrade() -> None:
    # 重建 data_assets 表
    op.create_table(
        "data_assets",
        sa.Column("feishu_record_id", sa.String(128), primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("source_app_token", sa.String(128), nullable=False),
        sa.Column("source_table_id", sa.String(128), nullable=True),
        sa.Column("asset_type", sa.String(32), nullable=False, server_default="conversation"),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("content_text", sa.Text(), nullable=False),
        sa.Column("asset_tags", JSONB(), nullable=False, server_default="{}"),
        sa.Column("feishu_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feishu_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "asset_type IN ('conversation', 'meeting_note', 'document', 'other')",
            name="ck_data_assets_type",
        ),
    )
    op.execute("ALTER TABLE data_assets ADD COLUMN content_vector vector(1536)")
    op.create_index("idx_assets_owner", "data_assets", ["owner_id"])
    op.create_index("idx_assets_type", "data_assets", ["asset_type"])
    op.create_index("idx_assets_tags", "data_assets", ["asset_tags"], postgresql_using="gin")

    # 迁移数据回 data_assets
    op.execute("""
        INSERT INTO data_assets (
            feishu_record_id, owner_id, source_app_token, source_table_id,
            asset_type, title, content_text, content_vector,
            asset_tags, feishu_created_at, feishu_updated_at,
            synced_at, created_at, updated_at
        )
        SELECT
            feishu_record_id, owner_id, coalesce(source_app_token, ''), source_table_id,
            'document', title, content_text, content_vector,
            tags, feishu_created_at, feishu_updated_at,
            coalesce(synced_at, now()), created_at, updated_at
        FROM documents
        WHERE feishu_record_id IS NOT NULL
    """)

    # 删除新表
    op.drop_table("user_departments")
    op.drop_table("departments")
    op.drop_table("chat_messages")
    op.drop_table("meetings")
    op.drop_table("documents")

    # 移除 etl_data_sources.owner_id
    op.drop_column("etl_data_sources", "owner_id")

    # 恢复约束
    op.drop_constraint("ck_etl_ds_asset_type", "etl_data_sources", type_="check")
    op.create_check_constraint(
        "ck_etl_ds_asset_type",
        "etl_data_sources",
        "asset_type IN ('conversation', 'meeting_note', 'document', 'other')",
    )

    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", "role IN ('employee', 'executive', 'admin')")
