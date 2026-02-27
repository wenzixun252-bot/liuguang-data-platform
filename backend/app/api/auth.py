"""飞书 OAuth 登录接口。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.user import User
from app.schemas.user import FeishuCallbackRequest, TokenResponse, UserOut
from app.services.feishu import FeishuAPIError, feishu_client
from app.utils.security import create_access_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["鉴权"])


@router.post("/feishu/callback", response_model=TokenResponse, summary="飞书 OAuth 回调")
async def feishu_callback(
    body: FeishuCallbackRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    """接收前端传来的飞书临时授权码，换取用户信息，Upsert 到 users 表，签发 JWT。"""
    # 1. 调飞书 API 获取用户信息
    try:
        user_info = await feishu_client.get_user_info_by_code(body.code)
    except FeishuAPIError as e:
        logger.error("飞书 OAuth 失败: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"飞书认证失败: {e}",
        )
    except Exception as e:
        logger.error("飞书 API 调用异常: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="飞书服务不可用，请稍后重试",
        )

    # 2. Upsert 用户
    result = await db.execute(
        select(User).where(User.feishu_open_id == user_info["open_id"])
    )
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            feishu_open_id=user_info["open_id"],
            feishu_union_id=user_info.get("union_id"),
            name=user_info["name"],
            avatar_url=user_info.get("avatar_url"),
            email=user_info.get("email"),
        )
        db.add(user)
    else:
        user.feishu_union_id = user_info.get("union_id") or user.feishu_union_id
        user.name = user_info["name"]
        user.avatar_url = user_info.get("avatar_url") or user.avatar_url
        user.email = user_info.get("email") or user.email

    await db.commit()
    await db.refresh(user)

    # 3. 签发 JWT
    token = create_access_token({"sub": user.feishu_open_id, "role": user.role})

    return TokenResponse(
        access_token=token,
        user=UserOut.model_validate(user),
    )
