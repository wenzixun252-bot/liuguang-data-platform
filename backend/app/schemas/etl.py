"""ETL 相关的 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel


class SyncStateOut(BaseModel):
    """ETL 同步状态响应体。"""
    id: int
    source_app_token: str
    source_table_id: str
    last_sync_time: datetime
    last_sync_status: str
    records_synced: int | None = 0
    error_message: str | None = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class RegistryEntryOut(BaseModel):
    """注册中心条目响应体。"""
    app_token: str
    table_id: str
    table_name: str = ""
    asset_type: str = "document"
    is_enabled: bool = True


class ETLTriggerResponse(BaseModel):
    """手动触发 ETL 的响应体。"""
    message: str
    sources_count: int


class DataSourceCreate(BaseModel):
    """创建数据源请求体。"""
    app_token: str
    table_id: str
    table_name: str = ""
    asset_type: str = "document"
    default_tag_ids: list[int] = []
    include_shared: bool = True


class DataSourceOut(BaseModel):
    """数据源响应体。"""
    id: int
    app_token: str
    table_id: str
    table_name: str
    asset_type: str
    owner_id: str | None = None
    default_tag_ids: list[int] = []
    include_shared: bool = True
    is_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DataSourceToggle(BaseModel):
    """启用/禁用数据源。"""
    is_enabled: bool


class DataSourceUpdateTags(BaseModel):
    """更新数据源默认标签。"""
    default_tag_ids: list[int]


class DataSourceWithSyncOut(BaseModel):
    """数据源 + 同步状态合并响应体。"""
    id: int
    app_token: str
    table_id: str
    table_name: str
    asset_type: str
    owner_id: str | None = None
    owner_name: str | None = None
    default_tag_ids: list[int] = []
    is_enabled: bool
    created_at: datetime
    updated_at: datetime
    include_shared: bool = True
    # 同步状态
    last_sync_status: str | None = None
    last_sync_time: datetime | None = None
    records_synced: int | None = 0
    error_message: str | None = None


# ── 云文件夹 ──

class CloudFolderCreate(BaseModel):
    """创建云文件夹源请求体。"""
    folder_token: str
    folder_name: str = ""
    include_shared: bool = True


class CloudFolderOut(BaseModel):
    """云文件夹源响应体。"""
    id: int
    folder_token: str
    folder_name: str
    owner_id: str
    include_shared: bool = True
    is_enabled: bool
    last_sync_time: datetime | None = None
    last_sync_status: str = "idle"
    files_synced: int = 0
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CloudFolderToggle(BaseModel):
    """启用/禁用云文件夹。"""
    is_enabled: bool
