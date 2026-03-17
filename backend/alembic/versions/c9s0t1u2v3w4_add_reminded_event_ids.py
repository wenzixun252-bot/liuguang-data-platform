"""add reminded_event_ids jsonb to calendar_reminder_prefs

Revision ID: c9s0t1u2v3w4
Revises: a7q8r9s0t1u2
Create Date: 2026-03-17 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "c9s0t1u2v3w4"
down_revision: Union[str, None] = "a7q8r9s0t1u2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "calendar_reminder_prefs",
        sa.Column("reminded_event_ids", JSONB, server_default="[]", nullable=True),
    )


def downgrade() -> None:
    op.drop_column("calendar_reminder_prefs", "reminded_event_ids")
