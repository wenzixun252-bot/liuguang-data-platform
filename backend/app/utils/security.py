"""JWT 签发与验证工具。"""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.config import settings


def create_access_token(data: dict) -> str:
    """签发 JWT。

    payload 包含 sub (feishu_open_id)、role、exp。
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """验证并解码 JWT。

    Returns:
        解码后的 payload 字典。

    Raises:
        JWTError: token 无效或已过期。
    """
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
