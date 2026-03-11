"""add extraction_rule_id to etl_data_sources

Revision ID: 23d9b40c8e80
Revises: 08d252d21666
Create Date: 2026-03-11

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "23d9b40c8e80"
down_revision = "c8e804ef9da6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("etl_data_sources", sa.Column("extraction_rule_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("etl_data_sources", "extraction_rule_id")
