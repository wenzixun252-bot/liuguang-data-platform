"""部门与用户部门关系模型。"""

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    feishu_department_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("departments.id"))
    feishu_parent_id: Mapped[str | None] = mapped_column(String(128))
    order_val: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())


class UserDepartment(Base):
    __tablename__ = "user_departments"
    __table_args__ = (
        UniqueConstraint("user_id", "department_id", name="uq_user_department"),
        Index("idx_ud_user", "user_id"),
        Index("idx_ud_dept", "department_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    department_id: Mapped[int] = mapped_column(Integer, ForeignKey("departments.id"), nullable=False)
    is_manager: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")


class UserVisibilityOverride(Base):
    """管理员手动设置的用户数据可见范围覆盖。"""
    __tablename__ = "user_visibility_overrides"
    __table_args__ = (
        UniqueConstraint("user_id", "department_id", name="uq_user_vis_override"),
        Index("idx_uvo_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    department_id: Mapped[int] = mapped_column(Integer, ForeignKey("departments.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
