"""add structured_tables and structured_table_rows

Revision ID: j0e1f2g3h4i5
Revises: i9d0e1f2g3h4
Create Date: 2026-03-03 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "j0e1f2g3h4i5"
down_revision = "i9d0e1f2g3h4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- structured_tables（表级元数据）
    op.create_table(
        "structured_tables",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(512), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_app_token", sa.String(128), nullable=True),
        sa.Column("source_table_id", sa.String(128), nullable=True),
        sa.Column("source_url", sa.String(1024), nullable=True),
        sa.Column("file_name", sa.String(512), nullable=True),
        sa.Column("schema_info", JSONB(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("column_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "source_type IN ('bitable', 'spreadsheet', 'local')",
            name="ck_structured_table_source_type",
        ),
        sa.UniqueConstraint(
            "owner_id", "source_app_token", "source_table_id",
            name="uq_structured_table_source",
        ),
    )
    op.create_index("idx_str_table_owner", "structured_tables", ["owner_id"])
    op.create_index("idx_str_table_source_type", "structured_tables", ["source_type"])

    # -- structured_table_rows（行级数据）
    op.create_table(
        "structured_table_rows",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "table_id",
            sa.Integer(),
            sa.ForeignKey("structured_tables.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("row_data", JSONB(), nullable=False, server_default="{}"),
        sa.Column("row_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_str_row_table_id", "structured_table_rows", ["table_id"])

    # GIN 索引：row_data JSONB 包含查询
    op.execute(
        "CREATE INDEX idx_str_row_data_gin ON structured_table_rows USING GIN (row_data)"
    )

    # GIN 全文搜索索引（simple 配置，适合中文人名等）
    op.execute(
        "CREATE INDEX idx_str_row_tsvector ON structured_table_rows "
        "USING GIN (to_tsvector('simple', COALESCE(row_text, '')))"
    )

    # pg_trgm 三元组索引（支持 ilike 高效匹配）
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX idx_str_row_text_trgm ON structured_table_rows "
        "USING GIN (row_text gin_trgm_ops)"
    )


def downgrade() -> None:
    op.drop_index("idx_str_row_text_trgm", table_name="structured_table_rows")
    op.execute("DROP INDEX IF EXISTS idx_str_row_tsvector")
    op.execute("DROP INDEX IF EXISTS idx_str_row_data_gin")
    op.drop_index("idx_str_row_table_id", table_name="structured_table_rows")
    op.drop_table("structured_table_rows")
    op.drop_index("idx_str_table_source_type", table_name="structured_tables")
    op.drop_index("idx_str_table_owner", table_name="structured_tables")
    op.drop_table("structured_tables")
