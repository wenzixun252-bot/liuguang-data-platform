"""个人设置相关的 Pydantic 模型。"""

from pydantic import BaseModel

from app.schemas.types import UTCDatetime, UTCDatetimeOpt


# ── 通知偏好 ──

class NotificationPrefOut(BaseModel):
    on_sync_completed: bool = True
    on_sync_failed: bool = True
    on_new_data: bool = True
    on_tag_suggestion: bool = False
    on_share_received: bool = True

    model_config = {"from_attributes": True}


class NotificationPrefUpdate(BaseModel):
    on_sync_completed: bool | None = None
    on_sync_failed: bool | None = None
    on_new_data: bool | None = None
    on_tag_suggestion: bool | None = None
    on_share_received: bool | None = None


# ── 关键词同步规则 ──

class KeywordSyncRuleCreate(BaseModel):
    keyword: str
    include_shared: bool = True
    default_tag_ids: list[int] = []


class KeywordSyncRuleOut(BaseModel):
    id: int
    keyword: str
    include_shared: bool = True
    default_tag_ids: list[int] = []
    is_enabled: bool
    last_scan_time: UTCDatetimeOpt = None
    docs_matched: int = 0
    created_at: UTCDatetime

    model_config = {"from_attributes": True}


class KeywordSyncRuleToggle(BaseModel):
    is_enabled: bool


class KeywordSyncRuleUpdateTags(BaseModel):
    default_tag_ids: list[int]


class KeywordPreviewRequest(BaseModel):
    keyword: str


class KeywordPreviewDoc(BaseModel):
    token: str
    name: str
    doc_type: str
    url: str
    owner_id: str = ""
    owner_name: str = ""
    create_time: str | None = None


class KeywordFastImportRequest(BaseModel):
    docs: list[KeywordPreviewDoc]
    tag_ids: list[int] = []


# ── 数据分享 ──

class SharingUpdate(BaseModel):
    target_user_ids: list[int] = []
    target_department_ids: list[int] = []


class SharingOut(BaseModel):
    target_user_ids: list[int] = []
    target_department_ids: list[int] = []


# ── 个人信息 ──

class ProfileOut(BaseModel):
    id: int
    name: str
    email: str | None = None
    avatar_url: str | None = None
    role: str
    departments: list[str] = []
