"""飞书事件订阅的 AES 解密与签名校验工具。"""

import base64
import hashlib
import json
import logging

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

logger = logging.getLogger(__name__)


def decrypt_event(encrypt_data: str, encrypt_key: str) -> dict:
    """解密飞书事件订阅的 AES-256-CBC 加密内容。

    飞书使用 AES-256-CBC 加密，key 为 SHA256(encrypt_key) 的前 32 字节，
    密文格式为 Base64(IV + ciphertext)。
    """
    key = hashlib.sha256(encrypt_key.encode("utf-8")).digest()
    raw = base64.b64decode(encrypt_data)
    iv = raw[:16]
    ciphertext = raw[16:]

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()

    unpadder = PKCS7(128).unpadder()
    plaintext = unpadder.update(padded) + unpadder.finalize()
    return json.loads(plaintext.decode("utf-8"))


def verify_signature(timestamp: str, nonce: str, encrypt_key: str, body: str) -> str:
    """计算飞书 v2 事件的 SHA256 签名，用于校验请求真实性。"""
    content = timestamp + nonce + encrypt_key + body
    return hashlib.sha256(content.encode("utf-8")).hexdigest()
