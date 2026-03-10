"""add_structured_asset_type

ETLDataSource 的 asset_type 约束增加 'structured' 选项，
支持结构化数仓类型的多维表格数据源。

Revision ID: u1k2l3m4n5o6
Revises: t0j1k2l3m4n5
Create Date: 2026-03-09
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "u1k2l3m4n5o6"
down_revision = "t0j1k2l3m4n5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_etl_ds_asset_type", "etl_data_sources", type_="check")
    op.create_check_constraint(
        "ck_etl_ds_asset_type",
        "etl_data_sources",
        "asset_type IN ('document', 'communication', 'structured')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_etl_ds_asset_type", "etl_data_sources", type_="check")
    op.create_check_constraint(
        "ck_etl_ds_asset_type",
        "etl_data_sources",
        "asset_type IN ('document', 'communication')",
    )
