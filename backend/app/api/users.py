"""用户信息管理接口。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.models.user import User
from app.schemas.user import RoleUpdateRequest, UserOut

router = APIRouter(prefix="/api/users", tags=["用户"])


@router.get("/me", response_model=UserOut, summary="当前用户信息")
async def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserOut:
    """返回当前登录用户信息。"""
    return UserOut.model_validate(current_user)


@router.get("", response_model=list[UserOut], summary="用户列表 (仅管理员)")
async def list_users(
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UserOut]:
    """仅 admin 角色可访问，返回所有用户列表。"""
    result = await db.execute(select(User).order_by(User.id))
    users = result.scalars().all()
    return [UserOut.model_validate(u) for u in users]


@router.patch("/{feishu_open_id}/role", response_model=UserOut, summary="修改用户角色 (仅管理员)")
async def update_user_role(
    feishu_open_id: str,
    body: RoleUpdateRequest,
    _admin: Annotated[User, Depends(require_role(["admin"]))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserOut:
    """仅 admin 可修改用户角色。"""
    result = await db.execute(
        select(User).where(User.feishu_open_id == feishu_open_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在",
        )

    user.role = body.role
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)
