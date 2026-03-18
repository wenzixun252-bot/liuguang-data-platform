"""飞书事件订阅 & 消息卡片回调路由。

这两个接口不需要 JWT 认证，调用方是飞书服务器。
安全性通过 Verification Token / Encrypt Key 保证。
"""

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.services.feishu_bot import feishu_bot_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/feishu", tags=["飞书回调"])

# ── 消息去重：内存级缓存（event_id → 处理时间戳） ─────────────
_processed_events: dict[str, float] = {}
_EVENT_TTL = 300  # 5 分钟


def _is_duplicate(event_id: str) -> bool:
    """检查事件是否已处理过，并清理过期条目。"""
    now = time.time()
    # 清理过期条目（惰性清理，每次最多清理 100 条）
    expired = [k for k, v in list(_processed_events.items())[:100] if now - v > _EVENT_TTL]
    for k in expired:
        _processed_events.pop(k, None)

    if event_id in _processed_events:
        return True
    _processed_events[event_id] = now
    return False


# ── 事件订阅回调 ──────────────────────────────────────────────

@router.post("/event", summary="飞书事件订阅回调")
async def feishu_event_callback(request: Request):
    """接收飞书事件订阅的 HTTP POST 回调。

    处理两类请求：
    1. URL 验证（首次配置时飞书发送 challenge）
    2. 消息事件（用户给机器人发消息）
    """
    raw_body = await request.body()
    body_str = raw_body.decode("utf-8")

    try:
        payload = json.loads(body_str)
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    # 如果配置了 Encrypt Key，先解密
    if settings.feishu_encrypt_key and "encrypt" in payload:
        try:
            from app.services.feishu_crypto import decrypt_event
            payload = decrypt_event(payload["encrypt"], settings.feishu_encrypt_key)
        except Exception as e:
            logger.error("飞书事件解密失败: %s", e)
            return JSONResponse({"error": "decrypt failed"}, status_code=400)

    # 1. URL 验证（首次配置回调地址时）
    if payload.get("type") == "url_verification":
        challenge = payload.get("challenge", "")
        logger.info("飞书 URL 验证请求，返回 challenge")
        return JSONResponse({"challenge": challenge})

    # 2. 验证 Verification Token
    header = payload.get("header", {})
    token = header.get("token") or payload.get("token", "")
    if settings.feishu_verification_token and token != settings.feishu_verification_token:
        logger.warning("飞书事件 token 校验失败")
        return JSONResponse({"error": "invalid token"}, status_code=403)

    # 3. 事件去重
    event_id = header.get("event_id", "")
    if event_id and _is_duplicate(event_id):
        logger.debug("重复事件，跳过: %s", event_id)
        return JSONResponse({"code": 0})

    # 4. 处理消息事件
    event_type = header.get("event_type", "")
    if event_type == "im.message.receive_v1":
        event_data = payload.get("event", {})
        # 异步处理，不阻塞回调（飞书要求 3 秒内返回）
        asyncio.create_task(
            _safe_handle_message(event_data)
        )
    elif event_type == "task.task.updated_v1":
        asyncio.create_task(
            _safe_handle_task_update(payload.get("event", {}))
        )
    else:
        logger.info("收到非消息事件，忽略: %s", event_type)

    return JSONResponse({"code": 0})


async def _safe_handle_message(event_data: dict) -> None:
    """安全地处理消息，捕获所有异常避免 task 静默失败。"""
    try:
        await feishu_bot_service.handle_message(event_data)
    except Exception as e:
        logger.error("处理飞书消息事件失败: %s", e, exc_info=True)


async def _safe_handle_task_update(event_data: dict) -> None:
    """处理飞书任务更新事件，同步完成状态到平台。"""
    try:
        from datetime import datetime
        from sqlalchemy import select, and_
        from app.database import async_session
        from app.models.todo_item import TodoItem
        from app.services.feishu import feishu_client

        task_id = event_data.get("task_id") or event_data.get("object", {}).get("task_id", "")
        if not task_id:
            logger.warning("飞书任务事件缺少 task_id: %s", event_data)
            return

        task_data = await feishu_client.get_task_detail(task_id)
        if not task_data:
            return

        if not task_data.get("completed_at") or task_data["completed_at"] == "0":
            return

        async with async_session() as db:
            result = await db.execute(
                select(TodoItem).where(
                    and_(
                        TodoItem.feishu_task_id == task_id,
                        TodoItem.status == "in_progress",
                    )
                )
            )
            todo = result.scalar_one_or_none()
            if todo:
                todo.status = "completed"
                todo.completed_at = datetime.utcnow()
                await db.commit()
                logger.info("飞书任务 %s 已完成，待办 #%d 状态已同步", task_id, todo.id)
    except Exception as e:
        logger.error("处理飞书任务更新事件失败: %s", e, exc_info=True)


# ── 消息卡片回调 ──────────────────────────────────────────────

@router.post("/card", summary="飞书消息卡片回调")
async def feishu_card_callback(request: Request):
    """接收飞书消息卡片的按钮点击回调。

    返回值会被飞书用来替换原卡片内容。
    """
    raw_body = await request.body()
    body_str = raw_body.decode("utf-8")

    try:
        payload = json.loads(body_str)
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    # URL 验证（飞书配置回调地址时也会发 challenge）
    if payload.get("type") == "url_verification":
        challenge = payload.get("challenge", "")
        logger.info("卡片回调 URL 验证请求，返回 challenge")
        return JSONResponse({"challenge": challenge})

    # 验证 token（卡片回调的 token 可能在顶层或 header 中）
    token = payload.get("token", "") or payload.get("header", {}).get("token", "")
    logger.info("卡片回调 payload keys: %s, token=%s", list(payload.keys()), token[:10] if token else "empty")
    if settings.feishu_verification_token and token != settings.feishu_verification_token:
        logger.warning("卡片回调 token 校验失败, got=%s, expected=%s", token[:10] if token else "empty", settings.feishu_verification_token[:10])
        return JSONResponse({"error": "invalid token"}, status_code=403)

    # 处理按钮点击 / 表单提交交互
    # 飞书卡片回调 v2 格式：action 数据在 event 中
    event = payload.get("event", {})
    if event:
        # v2 格式：将 event 中的字段提升到顶层供 handler 使用
        callback_data = {
            "open_id": event.get("operator", {}).get("open_id", ""),
            "action": event.get("action", {}),
            "token": token,
        }
        logger.info("卡片回调 v2 event: open_id=%s, action=%s", callback_data["open_id"], json.dumps(event.get("action", {}), ensure_ascii=False)[:200])
    else:
        # v1 格式：直接使用 payload
        callback_data = payload

    try:
        updated_card = await feishu_bot_service.handle_card_action(callback_data)
        if updated_card:
            return JSONResponse(updated_card)
        return JSONResponse({})
    except Exception as e:
        logger.error("处理卡片回调失败: %s", e, exc_info=True)
        return JSONResponse({})
