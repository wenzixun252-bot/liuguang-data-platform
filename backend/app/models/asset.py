from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class DataAsset(Base):
    __tablename__ = "data_assets"
    __table_args__ = (
        CheckConstraint(
            "asset_type IN ('conversation', 'meeting_note', 'document', 'other')",
            name="ck_data_assets_type",
        ),
        Index("idx_assets_owner", "owner_id"),
        Index("idx_assets_type", "asset_type"),
        Index("idx_assets_tags", "asset_tags", postgresql_using="gin"),
    )

    feishu_record_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    source_table_id: Mapped[str | None] = mapped_column(String(128))
    asset_type: Mapped[str] = mapped_column(String(32), nullable=False, server_default="conversation")
    title: Mapped[str | None] = mapped_column(String(512))
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    content_vector = mapped_column(Vector(settings.embedding_dimension), nullable=True)
    asset_tags: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    feishu_created_at: Mapped[datetime | None] = mapped_column()
    feishu_updated_at: Mapped[datetime | None] = mapped_column()
    synced_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())


class ETLSyncState(Base):
    __tablename__ = "etl_sync_state"
    __table_args__ = (
        CheckConstraint(
            "last_sync_status IN ('idle', 'running', 'success', 'failed')",
            name="ck_etl_sync_status",
        ),
        Index("uq_etl_sync_source", "source_app_token", "source_table_id", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    source_app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    source_table_id: Mapped[str] = mapped_column(String(128), nullable=False)
    last_sync_time: Mapped[datetime] = mapped_column(nullable=False, server_default="1970-01-01T00:00:00+00:00")
    last_sync_status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="idle")
    records_synced: Mapped[int | None] = mapped_column(default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())


class SchemaMappingCache(Base):
    __tablename__ = "schema_mapping_cache"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    source_app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    source_table_id: Mapped[str] = mapped_column(String(128), nullable=False)
    schema_md5: Mapped[str] = mapped_column(String(32), nullable=False)
    mapping_result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        Index(
            "uq_schema_cache",
            "source_app_token",
            "source_table_id",
            "schema_md5",
            unique=True,
        ),
    )


class ETLDataSource(Base):
    """本地数据源注册表 — 管理员在前端页面添加的飞书多维表格数据源。"""

    __tablename__ = "etl_data_sources"
    __table_args__ = (
        Index("uq_etl_ds", "app_token", "table_id", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    table_id: Mapped[str] = mapped_column(String(128), nullable=False)
    table_name: Mapped[str] = mapped_column(String(256), nullable=False, server_default="")
    asset_type: Mapped[str] = mapped_column(String(32), nullable=False, server_default="conversation")
    is_enabled: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
