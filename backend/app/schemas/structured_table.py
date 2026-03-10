"""结构化数据表 Pydantic 模型。"""

from pydantic import BaseModel

from app.schemas.types import UTCDatetime, UTCDatetimeOpt


class StructuredTableOut(BaseModel):
    """表级输出（列表用）。"""
    id: int
    owner_id: str
    name: str
    description: str | None = None
    summary: str | None = None
    source_type: str
    source_platform: str | None = None
    source_url: str | None = None
    file_name: str | None = None
    row_count: int = 0
    column_count: int = 0
    keywords: list = []
    sentiment: str | None = None
    quality_score: float | None = None
    duplicate_of: int | None = None
    parse_status: str = "done"
    processed_at: UTCDatetimeOpt = None
    synced_at: UTCDatetimeOpt = None
    created_at: UTCDatetime
    updated_at: UTCDatetime

    model_config = {"from_attributes": True}


class StructuredTableDetail(BaseModel):
    """表级详情（含 schema_info）。"""
    id: int
    owner_id: str
    name: str
    description: str | None = None
    summary: str | None = None
    content_text: str | None = None
    source_type: str
    source_platform: str | None = None
    source_app_token: str | None = None
    source_table_id: str | None = None
    source_url: str | None = None
    feishu_record_id: str | None = None
    file_name: str | None = None
    schema_info: list | None = None
    row_count: int = 0
    column_count: int = 0
    keywords: list = []
    sentiment: str | None = None
    quality_score: float | None = None
    duplicate_of: int | None = None
    extra_fields: dict = {}
    parse_status: str = "done"
    processed_at: UTCDatetimeOpt = None
    synced_at: UTCDatetimeOpt = None
    created_at: UTCDatetime
    updated_at: UTCDatetime

    model_config = {"from_attributes": True}


class StructuredTableRowOut(BaseModel):
    """单行输出。"""
    id: int
    row_index: int
    row_data: dict

    model_config = {"from_attributes": True}


class StructuredTableListResponse(BaseModel):
    """表格列表响应。"""
    items: list[StructuredTableOut]
    total: int


class StructuredTableRowListResponse(BaseModel):
    """行数据列表响应。"""
    items: list[StructuredTableRowOut]
    total: int


class ImportBitableRequest(BaseModel):
    """从飞书多维表格导入请求。"""
    app_token: str
    table_id: str


class ImportSpreadsheetRequest(BaseModel):
    """从飞书表格导入请求。"""
    spreadsheet_token: str
    sheet_id: str


class SearchResultItem(BaseModel):
    """穿透搜索结果条目。"""
    table_id: int
    table_name: str
    row_id: int
    row_index: int
    row_data: dict
    matched_fields: list[str]


class SearchResponse(BaseModel):
    """穿透搜索响应。"""
    keyword: str
    total: int
    results: list[SearchResultItem]


class ImportFromURLRequest(BaseModel):
    """通过飞书链接导入请求。"""
    url: str


class URLParseResult(BaseModel):
    """URL 解析结果。"""
    source_type: str  # bitable / spreadsheet
    app_token: str
    table_id: str | None = None
    tables: list[dict] | None = None  # 多维表格下的数据表列表
    sheets: list[dict] | None = None  # 飞书表格下的工作表列表


class BatchDeleteRequest(BaseModel):
    """批量删除请求。"""
    ids: list[int]
