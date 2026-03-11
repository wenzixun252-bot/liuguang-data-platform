"""知识图谱用户配置 — 存储用户的图谱生成偏好。"""

from datetime import datetime

from sqlalchemy import Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class KGProfile(Base):
    __tablename__ = "kg_profiles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)

    # 个人基本信息
    user_name: Mapped[str] = mapped_column(String(128), nullable=False, server_default="")
    user_role: Mapped[str] = mapped_column(String(128), nullable=False, server_default="")
    user_department: Mapped[str] = mapped_column(String(128), nullable=False, server_default="")
    user_description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")

    # 关注重点
    focus_people: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    focus_projects: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")

    # 业务域分类偏好
    domain_mode: Mapped[str] = mapped_column(String(32), nullable=False, server_default="function")
    custom_domains: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")

    # 数据源偏好
    data_sources: Mapped[list] = mapped_column(JSONB, nullable=False, server_default='["document","meeting","chat"]')
    time_range_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default="90")

    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
