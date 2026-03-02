"""公共依赖注入。"""

import logging
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.department import UserDepartment, UserDeptSharing, UserVisibilityOverride
from app.models.user import User
from app.utils.security import decode_access_token

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """异步数据库 Session 生成器。"""
    async with async_session() as session:
        yield session


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """从 Authorization: Bearer <token> 中解码 JWT，返回 User ORM 对象。"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效或过期的凭证",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(credentials.credentials)
        feishu_open_id: str | None = payload.get("sub")
        if feishu_open_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(
        select(User).where(User.feishu_open_id == feishu_open_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user


def require_role(allowed_roles: list[str]):
    """角色校验依赖工厂。非指定角色返回 403。"""

    async def _check_role(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="权限不足",
            )
        return current_user

    return _check_role


def is_super_admin(user: User) -> bool:
    """判断是否为系统超管（不可降级）。"""
    return user.feishu_open_id == settings.super_admin_open_id


async def get_visible_owner_ids(
    user: User,
    db: AsyncSession,
) -> list[str] | None:
    """根据用户角色返回可见的 owner_id 列表。

    - admin: 返回 None（看全部）
    - 普通用户: 返回 [自己] + [直接分享给我的人] + [分享给我所在部门的人]
    """
    if user.role == "admin":
        return None

    visible_ids: list[str] = [user.feishu_open_id]

    try:
        async with db.begin_nested():
            # 1. 谁直接分享给了我（user_id=分享者, target_user_id=我）
            r1 = await db.execute(
                select(User.feishu_open_id)
                .join(UserVisibilityOverride, UserVisibilityOverride.user_id == User.id)
                .where(UserVisibilityOverride.target_user_id == user.id)
            )
            visible_ids.extend(row[0] for row in r1.fetchall())

            # 2. 谁分享给了我所在的部门
            my_dept_ids_q = await db.execute(
                select(UserDepartment.department_id).where(UserDepartment.user_id == user.id)
            )
            my_dept_ids = [row[0] for row in my_dept_ids_q.fetchall()]

            if my_dept_ids:
                r2 = await db.execute(
                    select(User.feishu_open_id)
                    .join(UserDeptSharing, UserDeptSharing.user_id == User.id)
                    .where(UserDeptSharing.department_id.in_(my_dept_ids))
                )
                visible_ids.extend(row[0] for row in r2.fetchall())
    except Exception:
        logger.warning("可见性查询失败，请确认已运行 alembic upgrade head")

    return list(set(visible_ids))
