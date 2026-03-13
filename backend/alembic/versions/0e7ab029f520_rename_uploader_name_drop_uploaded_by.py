"""rename uploader_name to asset_owner_name and drop uploaded_by

Revision ID: 0e7ab029f520
Revises: 25c809e13ddc
Create Date: 2026-03-13 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0e7ab029f520"
down_revision = "25c809e13ddc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # documents: rename uploader_name → asset_owner_name, drop uploaded_by
    op.alter_column("documents", "uploader_name", new_column_name="asset_owner_name")
    op.drop_column("documents", "uploaded_by")

    # communications: rename uploader_name → asset_owner_name, drop uploaded_by
    op.alter_column("communications", "uploader_name", new_column_name="asset_owner_name")
    op.drop_column("communications", "uploaded_by")

    # structured_tables: rename uploaded_by → asset_owner_name
    # (structured_tables 原来没有 uploader_name，只有 uploaded_by)
    op.alter_column("structured_tables", "uploaded_by", new_column_name="asset_owner_name")


def downgrade() -> None:
    # structured_tables: 恢复 asset_owner_name → uploaded_by
    op.alter_column("structured_tables", "asset_owner_name", new_column_name="uploaded_by")

    # communications: 恢复
    op.add_column("communications", sa.Column("uploaded_by", sa.String(256), nullable=True))
    op.alter_column("communications", "asset_owner_name", new_column_name="uploader_name")

    # documents: 恢复
    op.add_column("documents", sa.Column("uploaded_by", sa.String(256), nullable=True))
    op.alter_column("documents", "asset_owner_name", new_column_name="uploader_name")
