"""清洗规则 Schema。"""

from datetime import datetime

from pydantic import BaseModel


class CleaningOptions(BaseModel):
    dedup: bool = True
    drop_empty_rows: bool = True
    empty_threshold: float = 0.5
    normalize_dates: bool = True
    normalize_numbers: bool = True
    trim_whitespace: bool = True
    llm_field_merge: bool = True
    llm_field_clean: bool = True


class CleaningRuleCreate(BaseModel):
    name: str
    options: CleaningOptions = CleaningOptions()
    field_hint: str = ""


class CleaningRuleUpdate(BaseModel):
    name: str | None = None
    options: CleaningOptions | None = None
    field_hint: str | None = None
    is_active: bool | None = None


class CleaningRuleOut(BaseModel):
    id: int
    name: str
    options: dict
    field_hint: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
