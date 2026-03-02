"""add cloud_folder_sources table

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-03-02 16:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "e1f2a3b4c5d6"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cloud_folder_sources",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("folder_token", sa.String(128), nullable=False),
        sa.Column("folder_name", sa.String(256), server_default="", nullable=False),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("last_sync_time", sa.DateTime(), nullable=True),
        sa.Column("last_sync_status", sa.String(16), server_default="idle", nullable=False),
        sa.Column("files_synced", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "last_sync_status IN ('idle', 'running', 'success', 'failed')",
            name="ck_cloud_folder_sync_status",
        ),
    )
    op.create_index(
        "uq_cloud_folder",
        "cloud_folder_sources",
        ["folder_token", "owner_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_cloud_folder", table_name="cloud_folder_sources")
    op.drop_table("cloud_folder_sources")
