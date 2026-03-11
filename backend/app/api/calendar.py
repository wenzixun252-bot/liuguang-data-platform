"""日程管家 API — 日历事件获取、会前简报生成、提醒偏好管理。"""

import json
import logging
from datetime import datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.config import settings
from app.services.llm import create_openai_client
from app.models.calendar_reminder import CalendarReminderPref
from app.models.conversation import Conversation, ConversationMessage
from app.models.user import User
from app.schemas.calendar import (
    BriefChatRequest,
    BriefRequest,
    CalendarAttendee,
    CalendarEventOut,
    ReminderPrefs,
)
from app.services.calendar import build_brief_prompt, gather_meeting_context
from app.services.feishu import FeishuAPIError, feishu_client
from app.services.rag import hybrid_searcher, match_tags_from_query

logger = logging.getLogger(__name__)

SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")

router = APIRouter(prefix="/api/calendar", tags=["日程管家"])


# ── 工具函数 ──────────────────────────────────────────────

def _parse_feishu_event(event: dict) -> CalendarEventOut | None:
    """将飞书日历 API 返回的事件解析为统一结构。"""
    event_id = event.get("event_id", "")
    summary = event.get("summary", "无标题")

    # 跳过已取消的事件
    status = event.get("status")
    if status == "cancelled":
        return None

    # 解析时间：飞书返回 timestamp 字符串（秒级）或 date 字符串（全天事件）
    start_info = event.get("start_time", {})
    end_info = event.get("end_time", {})

    start_ts = start_info.get("timestamp")
    end_ts = end_info.get("timestamp")

    try:
        if start_ts:
            start_time = datetime.fromtimestamp(int(start_ts), tz=SHANGHAI_TZ)
            end_time = datetime.fromtimestamp(int(end_ts), tz=SHANGHAI_TZ) if end_ts else start_time + timedelta(hours=1)
        elif start_info.get("date"):
            # 全天事件：只有 date 字段，如 "2026-03-04"
            start_time = datetime.strptime(start_info["date"], "%Y-%m-%d").replace(tzinfo=SHANGHAI_TZ)
            if end_info.get("date"):
                end_time = datetime.strptime(end_info["date"], "%Y-%m-%d").replace(tzinfo=SHANGHAI_TZ)
            else:
                end_time = start_time + timedelta(days=1)
        else:
            logger.warning("事件 %s (%s) 缺少时间信息，跳过", event_id, summary)
            return None
    except (ValueError, TypeError) as e:
        logger.warning("事件 %s 时间解析失败: %s", event_id, e)
        return None

    # 解析参会人（兼容 attendees API 和内嵌格式）
    attendees = []
    raw_attendees = event.get("attendees", [])
    for att in raw_attendees:
        # display_name 是参会人接口的标准字段
        name = att.get("display_name") or att.get("name")
        # user_id / attendee_id 取 open_id
        open_id = att.get("user_id") or att.get("attendee_id")
        # rsvp_status: needs_action / accept / tentative / decline / removed
        status = att.get("rsvp_status") or att.get("status")
        # 跳过没有名字也没有 ID 的条目
        if not name and not open_id:
            continue
        attendees.append(CalendarAttendee(
            name=name,
            open_id=open_id,
            status=status,
        ))
    if raw_attendees:
        logger.debug("事件 %s 解析到 %d/%d 个参会人", event_id, len(attendees), len(raw_attendees))

    # 解析地点
    location = None
    loc_info = event.get("location")
    if loc_info:
        location = loc_info.get("name") or loc_info.get("address")

    # 解析视频会议链接
    meeting_url = None
    vc_info = event.get("vchat")
    if vc_info:
        meeting_url = vc_info.get("meeting_url")

    # 组织者：优先取 organizer.display_name
    organizer_name = None
    organizer_info = event.get("organizer")
    if organizer_info:
        organizer_name = organizer_info.get("display_name")

    return CalendarEventOut(
        event_id=event_id,
        summary=summary,
        description=event.get("description"),
        start_time=start_time,
        end_time=end_time,
        location=location,
        organizer_name=organizer_name,
        attendees=attendees,
        meeting_url=meeting_url,
    )


def _get_agent_client():
    return create_openai_client(
        api_key=settings.agent_llm_api_key,
        base_url=settings.agent_llm_base_url,
        timeout=120.0,
    )


async def _try_refresh_and_get_token(user: User, db: AsyncSession) -> str:
    """获取用户的 access_token，如果过期则尝试刷新。"""
    if not user.feishu_access_token:
        if not user.feishu_refresh_token:
            raise HTTPException(400, "飞书授权已过期，请重新登录")
        # 尝试刷新
        try:
            token_data = await feishu_client.refresh_user_access_token(user.feishu_refresh_token)
            user.feishu_access_token = token_data["access_token"]
            user.feishu_refresh_token = token_data.get("refresh_token", user.feishu_refresh_token)
            await db.commit()
            return user.feishu_access_token
        except Exception:
            raise HTTPException(400, "飞书授权已过期，请重新登录")
    return user.feishu_access_token


# ── 1. 获取日历事件 ──────────────────────────────────────

@router.get("/events", summary="获取日历事件")
async def get_calendar_events(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(default=3, ge=1, le=14, description="查询未来几天的日程"),
):
    """实时从飞书日历 API 获取用户的日程事件。"""
    token = await _try_refresh_and_get_token(current_user, db)

    now = datetime.now(tz=SHANGHAI_TZ)
    # 从今天凌晨开始
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=days)
    logger.info("查询日历事件: %s ~ %s (days=%d)", start.isoformat(), end.isoformat(), days)

    try:
        raw_events = await feishu_client.get_calendar_events(token, start, end)
    except FeishuAPIError as e:
        err_msg = str(e)
        logger.warning("飞书日历API错误: %s", err_msg)
        # token 过期/无效相关错误码，尝试刷新后重试一次
        is_token_error = any(kw in err_msg for kw in ["99991671", "99991668", "99991672", "99991677", "HTTP 401"])
        # 权限不足（scope 未授权），需要用户重新登录授权
        is_scope_error = "99991679" in err_msg or "permission" in err_msg.lower()
        if is_scope_error:
            raise HTTPException(400, "日历权限未授权，请退出并重新登录以授权日历访问")
        if is_token_error and current_user.feishu_refresh_token:
            try:
                old_token = token
                token_data = await feishu_client.refresh_user_access_token(current_user.feishu_refresh_token)
                current_user.feishu_access_token = token_data["access_token"]
                current_user.feishu_refresh_token = token_data.get("refresh_token", current_user.feishu_refresh_token)
                await db.commit()
                # 旧 token 的日历缓存已无效
                feishu_client.invalidate_calendar_cache(old_token)
                logger.info("token 已刷新，重试获取日历事件")
                raw_events = await feishu_client.get_calendar_events(current_user.feishu_access_token, start, end)
            except Exception as retry_err:
                logger.error("刷新token后重试仍失败: %s", retry_err)
                raise HTTPException(400, "飞书授权已过期，请重新登录")
        elif is_token_error:
            raise HTTPException(400, "飞书授权已过期，请重新登录")
        else:
            raise HTTPException(502, f"获取日历事件失败: {err_msg}")
    except Exception as e:
        logger.error("获取日历事件未预期异常: %s", e)
        raise HTTPException(502, f"获取日历事件失败: {e}")

    # 解析并排序
    events = []
    skipped = 0
    for raw in raw_events:
        parsed = _parse_feishu_event(raw)
        if parsed:
            events.append(parsed)
        else:
            skipped += 1

    events.sort(key=lambda e: e.start_time)
    logger.info("返回 %d 个事件 (跳过 %d 个)", len(events), skipped)
    return events


# ── 2. 生成会前简报 (SSE) ─────────────────────────────────

@router.post("/brief", summary="生成会前简报 (SSE)")
async def generate_brief(
    request: Request,
    body: BriefRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """根据日历事件生成 AI 会前准备简报，通过 SSE 流式返回。"""
    owner_id = current_user.feishu_open_id
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    attendee_names = [a.name for a in body.attendees if a.name]

    # 从会议主题中匹配标签
    tag_query = body.summary + (" " + body.description if body.description else "")
    matched_tags = await match_tags_from_query(tag_query, owner_id, db)
    boost_tag_ids = [t.id for t in matched_tags] if matched_tags else None

    # 收集上下文
    context = await gather_meeting_context(
        db=db,
        owner_id=owner_id,
        visible_ids=visible_ids,
        event_summary=body.summary,
        event_description=body.description,
        attendee_names=attendee_names,
        boost_tag_ids=boost_tag_ids,
    )

    # 构建 prompt
    system_prompt = build_brief_prompt(
        event_summary=body.summary,
        event_description=body.description,
        start_time=body.start_time,
        attendee_names=attendee_names,
        context=context,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"请为我的会议「{body.summary}」生成会前准备简报。"},
    ]

    async def _event_generator():
        client = _get_agent_client()
        full_content = ""
        try:
            stream = await client.chat.completions.create(
                model=settings.agent_llm_model,
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if not delta:
                    continue
                if delta.content:
                    full_content += delta.content
                    data = json.dumps({"type": "content", "content": delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"

            yield "data: [DONE]\n\n"

            # 保存到会话（如果指定了 conversation_id）
            if body.conversation_id and full_content:
                try:
                    result = await db.execute(
                        select(Conversation).where(
                            Conversation.id == body.conversation_id,
                            Conversation.owner_id == owner_id,
                        )
                    )
                    conv = result.scalar_one_or_none()
                    if conv:
                        db.add(ConversationMessage(
                            conversation_id=body.conversation_id,
                            role="user",
                            content=f"为会议「{body.summary}」生成会前简报",
                        ))
                        db.add(ConversationMessage(
                            conversation_id=body.conversation_id,
                            role="assistant",
                            content=full_content,
                        ))
                        await db.commit()
                except Exception as e:
                    logger.warning("保存简报到会话失败: %s", e)

        except Exception as e:
            logger.error("生成会前简报异常: %s", e, exc_info=True)
            data = json.dumps({"type": "error", "content": "生成简报时出错，请稍后重试"}, ensure_ascii=False)
            yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── 3. 简报追问 (SSE) ────────────────────────────────────

BRIEF_CHAT_SYSTEM = """你是"流光"会议准备助手。用户已经收到了一份会前简报，现在想进一步了解细节。
请基于简报内容和你的知识回答问题。使用简洁专业的中文。

## 会前简报内容
{brief_context}
"""


@router.post("/brief/chat", summary="简报追问 (SSE)")
async def brief_chat(
    request: Request,
    body: BriefChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """基于已生成的简报进行追问对话，SSE 流式返回。"""
    owner_id = current_user.feishu_open_id
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    # 从追问中匹配标签
    matched_tags = await match_tags_from_query(body.question, owner_id, db)
    boost_tag_ids = [t.id for t in matched_tags] if matched_tags else None

    # RAG 搜索补充上下文（带标签加权）
    rag_context = ""
    try:
        results = await hybrid_searcher.search(
            query_text=body.question,
            visible_ids=visible_ids if visible_ids else [owner_id],
            db=db,
            top_k=3,
            boost_tag_ids=boost_tag_ids,
        )
        if results:
            parts = []
            for i, r in enumerate(results, 1):
                parts.append(f"[{i}] {r.title or '无标题'}: {(r.content_text or '')[:300]}")
            rag_context = "\n\n## 补充检索结果\n" + "\n".join(parts)
    except Exception as e:
        logger.warning("简报追问 RAG 搜索失败: %s", e)

    brief_context = (body.event_context or "暂无简报内容") + rag_context

    msgs = [{"role": "system", "content": BRIEF_CHAT_SYSTEM.format(brief_context=brief_context)}]
    for m in (body.history or [])[-10:]:
        msgs.append({"role": m.role, "content": m.content})
    msgs.append({"role": "user", "content": body.question})

    source_id_list = [f"{r.source_table}:{r.id}" for r in results] if results else []

    async def _event_generator():
        client = _get_agent_client()
        full_content = ""
        try:
            stream = await client.chat.completions.create(
                model=settings.agent_llm_model,
                messages=msgs,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if not delta:
                    continue
                if delta.content:
                    full_content += delta.content
                    data = json.dumps({"type": "content", "content": delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"

            data = json.dumps({"type": "sources", "sources": source_id_list}, ensure_ascii=False)
            yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"

            # 保存会话
            if body.conversation_id and full_content:
                try:
                    result = await db.execute(
                        select(Conversation).where(
                            Conversation.id == body.conversation_id,
                            Conversation.owner_id == owner_id,
                        )
                    )
                    conv = result.scalar_one_or_none()
                    if conv:
                        db.add(ConversationMessage(
                            conversation_id=body.conversation_id,
                            role="user",
                            content=body.question,
                        ))
                        db.add(ConversationMessage(
                            conversation_id=body.conversation_id,
                            role="assistant",
                            content=full_content,
                            sources=source_id_list,
                        ))
                        await db.commit()
                except Exception as e:
                    logger.warning("保存追问消息失败: %s", e)
        except Exception as e:
            logger.error("简报追问异常: %s", e)
            data = json.dumps({"type": "error", "content": "回答时出错，请稍后重试"}, ensure_ascii=False)
            yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── 4. 提醒偏好 ──────────────────────────────────────────

@router.get("/reminder-prefs", response_model=ReminderPrefs, summary="获取提醒偏好")
async def get_reminder_prefs(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(CalendarReminderPref).where(
            CalendarReminderPref.owner_id == current_user.feishu_open_id,
        )
    )
    pref = result.scalar_one_or_none()
    if not pref:
        return ReminderPrefs()
    return ReminderPrefs(enabled=pref.enabled, minutes_before=pref.minutes_before)


@router.put("/reminder-prefs", response_model=ReminderPrefs, summary="更新提醒偏好")
async def update_reminder_prefs(
    body: ReminderPrefs,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(CalendarReminderPref).where(
            CalendarReminderPref.owner_id == current_user.feishu_open_id,
        )
    )
    pref = result.scalar_one_or_none()
    if pref:
        pref.enabled = body.enabled
        pref.minutes_before = body.minutes_before
    else:
        pref = CalendarReminderPref(
            owner_id=current_user.feishu_open_id,
            enabled=body.enabled,
            minutes_before=body.minutes_before,
        )
        db.add(pref)
    await db.commit()
    return ReminderPrefs(enabled=pref.enabled, minutes_before=pref.minutes_before)
