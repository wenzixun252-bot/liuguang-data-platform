"""JWT 签发/验证 单元测试。"""

import time
from unittest.mock import patch

import pytest
from jose import JWTError

from app.utils.security import create_access_token, decode_access_token


class TestJWT:
    """JWT 工具函数测试。"""

    def test_create_and_decode_token(self):
        """签发的 token 能正确解码。"""
        payload = {"sub": "test_open_id", "role": "employee"}
        token = create_access_token(payload)
        decoded = decode_access_token(token)

        assert decoded["sub"] == "test_open_id"
        assert decoded["role"] == "employee"
        assert "exp" in decoded

    def test_token_contains_expiration(self):
        """token 包含过期时间。"""
        token = create_access_token({"sub": "user1"})
        decoded = decode_access_token(token)
        assert decoded["exp"] > time.time()

    def test_decode_invalid_token(self):
        """无效 token 抛出 JWTError。"""
        with pytest.raises(JWTError):
            decode_access_token("invalid.token.here")

    def test_decode_expired_token(self):
        """过期 token 抛出 JWTError。"""
        with patch("app.utils.security.settings") as mock_settings:
            mock_settings.jwt_secret_key = "test-secret"
            mock_settings.jwt_algorithm = "HS256"
            mock_settings.jwt_expire_minutes = -1  # 立即过期
            token = create_access_token({"sub": "user1"})

        with pytest.raises(JWTError):
            decode_access_token(token)

    def test_different_payloads(self):
        """不同 payload 签发不同的 token。"""
        token1 = create_access_token({"sub": "user1", "role": "employee"})
        token2 = create_access_token({"sub": "user2", "role": "admin"})
        assert token1 != token2
