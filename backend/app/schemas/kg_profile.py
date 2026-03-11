"""知识图谱用户配置 Pydantic 模型。"""

from pydantic import BaseModel


class KGProfileCreate(BaseModel):
    user_name: str = ""
    user_role: str = ""
    user_department: str = ""
    user_description: str = ""
    focus_people: list[str] = []
    focus_projects: list[str] = []
    domain_mode: str = "function"
    custom_domains: list[str] = []
    data_sources: list[str] = ["document", "meeting", "chat"]
    time_range_days: int = 90


class KGProfileOut(KGProfileCreate):
    id: int
    owner_id: str

    model_config = {"from_attributes": True}
