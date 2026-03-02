"""公共依赖注入。"""

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.department import UserDepartment, UserVisibilityOverride
from app.models.user import User
from app.utils.security import decode_access_token

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


async def get_visible_owner_ids(
    user: User,
    db: AsyncSession,
) -> list[str] | None:
    """根据用户角色和部门关系，返回可见的 owner_id 列表。

    - admin: 返回 None（看全部）
    - 部门 manager: 返回本部门 + 下属部门所有人的 feishu_open_id 列表
    - 普通 employee: 返回 [自己的 feishu_open_id]
    """
    if user.role == "admin":
        return None

    # 检查用户是否是某个部门的 manager
    result = await db.execute(
        select(UserDepartment).where(
            UserDepartment.user_id == user.id,
            UserDepartment.is_manager == True,  # noqa: E712
        )
    )
    managed_depts = result.scalars().all()

    # 查询手动覆盖的可见部门
    override_result = await db.execute(
        select(UserVisibilityOverride.department_id).where(
            UserVisibilityOverride.user_id == user.id,
        )
    )
    override_dept_ids = [row[0] for row in override_result.fetchall()]

    # 合并自动管理部门 + 手动覆盖部门
    managed_dept_ids = [ud.department_id for ud in managed_depts]
    all_dept_ids = list(set(managed_dept_ids + override_dept_ids))

    if not all_dept_ids:
        return [user.feishu_open_id]

    # 使用递归 CTE 查找所有下属部门
    placeholders = ", ".join(f":dept_{i}" for i in range(len(all_dept_ids)))
    params = {f"dept_{i}": did for i, did in enumerate(all_dept_ids)}

    cte_sql = text(f"""
        WITH RECURSIVE dept_tree AS (
            SELECT id FROM departments WHERE id IN ({placeholders})
            UNION ALL
            SELECT d.id FROM departments d
            INNER JOIN dept_tree dt ON d.parent_id = dt.id
        )
        SELECT DISTINCT u.feishu_open_id
        FROM dept_tree dt
        JOIN user_departments ud ON ud.department_id = dt.id
        JOIN users u ON u.id = ud.user_id
    """)

    result = await db.execute(cte_sql, params)
    visible_ids = [row[0] for row in result.fetchall()]

    # 确保包含自己
    if user.feishu_open_id not in visible_ids:
        visible_ids.append(user.feishu_open_id)

    return visible_ids
