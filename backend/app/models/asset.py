"""ETL 相关模型 — 同步状态、Schema 缓存、数据源注册、云文件夹源。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


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
    """数据源注册表 — 管理员或用户添加的飞书多维表格数据源。"""

    __tablename__ = "etl_data_sources"
    __table_args__ = (
        CheckConstraint(
            "asset_type IN ('document', 'communication')",
            name="ck_etl_ds_asset_type",
        ),
        Index("uq_etl_ds", "app_token", "table_id", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    table_id: Mapped[str] = mapped_column(String(128), nullable=False)
    table_name: Mapped[str] = mapped_column(String(256), nullable=False, server_default="")
    asset_type: Mapped[str] = mapped_column(String(32), nullable=False, server_default="document")
    owner_id: Mapped[str | None] = mapped_column(String(64))
    default_tag_ids: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    include_shared: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    is_enabled: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())


class CloudFolderSource(Base):
    """云文件夹数据源 — 用户配置的飞书云文件夹，用于自动同步文档/文件。"""

    __tablename__ = "cloud_folder_sources"
    __table_args__ = (
        CheckConstraint(
            "last_sync_status IN ('idle', 'running', 'success', 'failed')",
            name="ck_cloud_folder_sync_status",
        ),
        Index("uq_cloud_folder", "folder_token", "owner_id", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    folder_token: Mapped[str] = mapped_column(String(128), nullable=False)
    folder_name: Mapped[str] = mapped_column(String(256), nullable=False, server_default="")
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    include_shared: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    is_enabled: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    last_sync_time: Mapped[datetime | None] = mapped_column()
    last_sync_status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="idle")
    files_synced: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
