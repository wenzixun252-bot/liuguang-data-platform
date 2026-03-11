"""提取规则 Schema。"""

from datetime import datetime

from pydantic import BaseModel


class ExtractionField(BaseModel):
    key: str
    label: str
    description: str
    builtin: bool = False
    sector: str = "custom"


class ExtractionRuleCreate(BaseModel):
    name: str
    sectors: list[str] = []
    fields: list[ExtractionField] = []
    prompt_hint: str = ""


class ExtractionRuleUpdate(BaseModel):
    name: str | None = None
    sectors: list[str] | None = None
    fields: list[ExtractionField] | None = None
    prompt_hint: str | None = None
    is_active: bool | None = None


class ExtractionRuleOut(BaseModel):
    id: int
    name: str
    sectors: list[str]
    fields: list[dict]
    prompt_hint: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
