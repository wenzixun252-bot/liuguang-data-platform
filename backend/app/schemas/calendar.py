"""日程管家相关的请求/响应模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


# ── 日历事件 ──────────────────────────────────────────────

class CalendarAttendee(BaseModel):
    """日程参会人。"""
    name: str | None = None
    open_id: str | None = None
    status: str | None = None  # accept / decline / tentative / needsAction


class CalendarEventOut(BaseModel):
    """飞书日历事件（返回给前端）。"""
    event_id: str
    summary: str
    description: str | None = None
    start_time: datetime
    end_time: datetime
    location: str | None = None
    organizer_name: str | None = None
    attendees: list[CalendarAttendee] = []
    meeting_url: str | None = None


# ── 会前简报 ──────────────────────────────────────────────

class BriefChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class BriefRequest(BaseModel):
    """会前简报生成请求。"""
    event_id: str
    summary: str
    description: str | None = None
    start_time: datetime
    attendees: list[CalendarAttendee] = []
    conversation_id: int | None = None


class BriefChatRequest(BaseModel):
    """简报追问请求。"""
    question: str
    conversation_id: int | None = None
    event_context: str | None = None  # 已生成的简报内容，作为上下文
    history: list[BriefChatMessage] = []


# ── 提醒偏好 ──────────────────────────────────────────────

class ReminderPrefs(BaseModel):
    """用户提醒偏好。"""
    enabled: bool = True
    minutes_before: int = 30
