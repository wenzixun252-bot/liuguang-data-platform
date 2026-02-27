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
    asset_type: str = "conversation"
    is_enabled: bool = True


class ETLTriggerResponse(BaseModel):
    """手动触发 ETL 的响应体。"""
    message: str
    sources_count: int
