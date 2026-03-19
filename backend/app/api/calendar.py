"""日程管家 API — 日历事件获取、会前简报生成、提醒偏好管理。"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.config import settings
from app.services.llm import create_openai_client
from app.models.calendar_brief import CalendarBrief
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


# ── 2. 生成会前简报（后台任务） ──────────────────────────────

# 内存中的简报任务字典：owner_id -> task state
_brief_tasks: dict[str, dict] = {}


async def _run_brief_task(
    owner_id: str,
    body: BriefRequest,
    visible_ids: list[str],
):
    """后台协程：收集上下文 + LLM 生成简报，结果写入 _brief_tasks。"""
    task = _brief_tasks[owner_id]
    try:
        # 需要独立的 DB session（后台任务不能复用请求级 session）
        from app.database import async_session

        async with async_session() as db:
            attendee_names = [a.name for a in body.attendees if a.name]

            task["message"] = "正在匹配标签..."
            tag_query = body.summary + (" " + body.description if body.description else "")
            matched_tags = await match_tags_from_query(tag_query, owner_id, db)
            boost_tag_ids = [t.id for t in matched_tags] if matched_tags else None

            task["message"] = "正在收集会议上下文..."
            task["progress"] = 20
            try:
                context = await gather_meeting_context(
                    db=db,
                    owner_id=owner_id,
                    visible_ids=visible_ids,
                    event_summary=body.summary,
                    event_description=body.description,
                    attendee_names=attendee_names,
                    boost_tag_ids=boost_tag_ids,
                )
            except Exception as e:
                logger.error("收集会议上下文失败: %s", e, exc_info=True)
                context = {
                    "participant_profiles": "上下文收集失败",
                    "historical_meetings": "上下文收集失败",
                    "related_documents": "上下文收集失败",
                    "pending_todos": "上下文收集失败",
                    "related_chats": "上下文收集失败",
                }

            task["message"] = "正在生成简报..."
            task["progress"] = 40

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

            client = _get_agent_client()
            full_content = ""
            stream = await client.chat.completions.create(
                model=settings.agent_llm_model,
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if not delta or not delta.content:
                    continue
                full_content += delta.content
                # 实时更新 content 以便前端轮询时能看到进度
                task["content"] = full_content
                # 根据内容长度粗略更新进度 40->95
                progress = min(40 + len(full_content) // 20, 95)
                task["progress"] = progress
                task["message"] = "正在生成简报..."

            task["status"] = "done"
            task["progress"] = 100
            task["message"] = "简报已生成"
            task["content"] = full_content

            # 自动持久化简报到数据库
            try:
                from sqlalchemy import select as sa_select
                result = await db.execute(
                    sa_select(CalendarBrief).where(
                        CalendarBrief.owner_id == owner_id,
                        CalendarBrief.event_id == body.event_id,
                    )
                )
                existing_brief = result.scalar_one_or_none()
                if existing_brief:
                    existing_brief.content = full_content
                    existing_brief.event_summary = body.summary
                    existing_brief.chat_messages = None
                else:
                    db.add(CalendarBrief(
                        owner_id=owner_id,
                        event_id=body.event_id,
                        event_summary=body.summary,
                        content=full_content,
                    ))
                await db.commit()
            except Exception as e:
                logger.warning("保存简报到数据库失败: %s", e)

    except asyncio.CancelledError:
        task["status"] = "cancelled"
        task["message"] = "已取消"
    except Exception as e:
        logger.error("生成会前简报异常: %s", e, exc_info=True)
        task["status"] = "error"
        task["progress"] = 100
        task["message"] = f"生成失败: {e}"


@router.post("/brief", summary="启动会前简报生成（后台任务）")
async def generate_brief(
    request: Request,
    body: BriefRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """启动后台任务生成会前简报，立即返回。前端通过 /brief/status 轮询进度。"""
    owner_id = current_user.feishu_open_id
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    # 如果已有正在运行的任务，取消旧的
    existing = _brief_tasks.get(owner_id)
    if existing and existing.get("status") == "running" and existing.get("_asyncio_task"):
        existing["_asyncio_task"].cancel()

    # 初始化任务状态
    _brief_tasks[owner_id] = {
        "status": "running",
        "progress": 0,
        "message": "准备中...",
        "content": "",
        "event_id": body.event_id,
        "event_summary": body.summary,
    }

    # 启动后台协程
    asyncio_task = asyncio.create_task(
        _run_brief_task(owner_id, body, visible_ids)
    )
    _brief_tasks[owner_id]["_asyncio_task"] = asyncio_task

    return {"status": "running", "message": "简报生成已启动"}


@router.get("/brief/status", summary="查询简报生成进度")
async def get_brief_status(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """轮询简报生成任务的进度和内容。"""
    owner_id = current_user.feishu_open_id
    task = _brief_tasks.get(owner_id)

    if not task:
        return {"status": "idle", "progress": 0, "message": "", "content": ""}

    return {
        "status": task["status"],
        "progress": task["progress"],
        "message": task["message"],
        "content": task.get("content", ""),
        "event_id": task.get("event_id", ""),
        "event_summary": task.get("event_summary", ""),
    }


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


# ── 3.5 简报持久化（保存/加载） ──────────────────────────


class SaveBriefChatRequest(BaseModel):
    """保存简报追问对话。"""
    event_id: str
    chat_messages: list[dict]


@router.get("/brief/saved/{event_id}", summary="获取已保存的简报")
async def get_saved_brief(
    event_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """根据 event_id 获取已持久化的会前简报。"""
    result = await db.execute(
        select(CalendarBrief).where(
            CalendarBrief.owner_id == current_user.feishu_open_id,
            CalendarBrief.event_id == event_id,
        )
    )
    brief = result.scalar_one_or_none()
    if not brief:
        return {"found": False, "content": "", "chat_messages": []}
    return {
        "found": True,
        "content": brief.content,
        "chat_messages": brief.chat_messages or [],
    }


@router.post("/brief/save-chat", summary="保存简报追问对话")
async def save_brief_chat(
    body: SaveBriefChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """将追问对话保存到已有的简报记录中。"""
    result = await db.execute(
        select(CalendarBrief).where(
            CalendarBrief.owner_id == current_user.feishu_open_id,
            CalendarBrief.event_id == body.event_id,
        )
    )
    brief = result.scalar_one_or_none()
    if not brief:
        return {"saved": False, "detail": "简报不存在"}
    brief.chat_messages = body.chat_messages
    await db.commit()
    return {"saved": True}


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


@router.post("/test-reminder", summary="立即触发一次会前简报检查（调试用）")
async def test_reminder(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """立即运行一次日程提醒任务，用于验证推送是否正常。"""
    from app.worker.scheduler import scheduler
    scheduler.modify_job("calendar_reminder_job", next_run_time=__import__("datetime").datetime.now(__import__("datetime").timezone.utc))
    return {"status": "ok", "message": "已触发提醒检查，稍后注意飞书消息"}


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
