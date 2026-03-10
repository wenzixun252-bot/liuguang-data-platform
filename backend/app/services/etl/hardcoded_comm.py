"""标准会话/会议多维表格的硬编码字段映射。

飞书配方产出的会话表和会议表字段结构固定，通过特征字段自动识别后
直接使用硬编码映射，跳过 LLM 和关键词匹配，保证同步效率。
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── 特征字段 ─────────────────────────────────────────────────

CHAT_SIGNATURE_FIELD = "聊天记录"
MEETING_SIGNATURE_FIELD = "会议名称"


def detect_comm_table_type(field_names: list[str]) -> str | None:
    """根据字段名识别是否为标准会话/会议表。"""
    if CHAT_SIGNATURE_FIELD in field_names:
        return "chat"
    if MEETING_SIGNATURE_FIELD in field_names:
        return "meeting"
    return None


# ── 硬编码映射字典 ────────────────────────────────────────────
# key = Communication 模型字段, value = 飞书多维表格字段名
# 以 _ 开头的 key 是特殊字段，需要在 apply 时做额外处理

CHAT_FIELD_MAPPING: dict[str, str] = {
    "content_text": "聊天记录",
    "owner_id": "配方 Owner",
    "initiator": "发送人",
    "comm_time": "发送时间",
    "chat_id": "所在群",
    "message_type": "消息类型",
    "source_url": "消息链接",
    "keywords": "关键词",
    "sentiment": "情感分析",
    "reply_to": "根消息ID",
}

MEETING_FIELD_MAPPING: dict[str, str] = {
    "title": "会议名称",
    "owner_id": "配方所有者",
    "comm_time": "会议时间",
    "duration_minutes": "会议时长取分钟值",
    "initiator": "会议组织者",
    "participants": "参会人",
    "source_url": "完整会议纪要",
    "recording_url": "会议录屏链接",
    "quality_score": "质量评价",
    # 以下两个特殊字段：拼接为 content_text，并从分析中提取 action_items
    "_meeting_summary": "会议总结",
    "_meeting_analysis": "会议分析",
}


# ── 值转换辅助函数 ────────────────────────────────────────────

_SENTIMENT_MAP = {
    "正向": "positive",
    "负向": "negative",
    "中性": "neutral",
}

_QUALITY_MAP = {
    "质量高": 1.0,
    "质量中等": 0.6,
    "质量低": 0.3,
}


def convert_sentiment(value: str | None) -> str | None:
    """中文情感标签 → 英文枚举。"""
    if not value:
        return None
    return _SENTIMENT_MAP.get(value.strip())


def convert_quality_score(value: str | None) -> float | None:
    """质量评价文本 → 数值分数。"""
    if not value:
        return None
    return _QUALITY_MAP.get(value.strip())


def build_meeting_content(summary: str, analysis: str) -> str:
    """拼接会议总结和会议分析为一个完整的 content_text。"""
    parts = []
    if summary:
        parts.append(f"## 会议总结\n{summary}")
    if analysis:
        parts.append(f"## 会议分析\n{analysis}")
    return "\n\n".join(parts) if parts else ""


# 匹配 "1. 具体待办内容，负责人@xxx" 格式
_ACTION_ITEM_RE = re.compile(
    r"(\d+)\.\s*(.+?)(?:，|,)\s*负责人\s*@\s*([^\s，,\n]+)",
)


def parse_meeting_action_items(analysis_text: str) -> list[dict]:
    """从会议分析文本中提取待办事项。

    飞书配方输出格式:
        ✅ **会后待办**
        1. 做某事，负责人@张三，需要在周五完成
        2. 做另一事，负责人@李四
    """
    if not analysis_text:
        return []

    # 找到待办部分
    todo_markers = ["会后待办", "✅"]
    start = -1
    for marker in todo_markers:
        idx = analysis_text.find(marker)
        if idx >= 0:
            start = idx
            break
    if start < 0:
        return []

    todo_section = analysis_text[start:]
    items = []
    for match in _ACTION_ITEM_RE.finditer(todo_section):
        task = match.group(2).strip().rstrip("，,")
        assignee = match.group(3).strip().rstrip("，,")
        items.append({"task": task, "assignee": assignee})

    # 如果正则没匹配到，尝试简单的编号列表提取
    if not items:
        for line in todo_section.split("\n"):
            line = line.strip()
            m = re.match(r"\d+\.\s*(.+)", line)
            if m:
                task_text = m.group(1).strip()
                if task_text and len(task_text) > 2:
                    items.append({"task": task_text})

    return items


def extract_user_name(value) -> str:
    """从飞书 User 字段提取用户名。"""
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            return first.get("name", first.get("en_name", ""))
    if isinstance(value, dict):
        return value.get("name", value.get("en_name", ""))
    return ""


def extract_user_id(value) -> str:
    """从飞书 User / CreatedUser 字段提取 open_id。"""
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            return first.get("id", first.get("open_id", ""))
    if isinstance(value, dict):
        return value.get("id", value.get("open_id", ""))
    if isinstance(value, str):
        return value.strip()
    return ""


def extract_url(value) -> str:
    """从飞书 Url 字段提取链接。"""
    if isinstance(value, dict):
        return value.get("link", value.get("url", ""))
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return value.strip()
    return ""


def extract_text(value) -> str:
    """通用文本提取（处理 Formula/Text/Lookup 等类型）。"""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(item.get("text", item.get("name", str(item))))
            else:
                parts.append(str(item))
        return " ".join(parts).strip()
    if isinstance(value, dict):
        return value.get("text", value.get("name", str(value)))
    return str(value)


def extract_int(value) -> int | None:
    """提取整数值（处理 Formula 数值类型）。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def parse_timestamp(value) -> datetime | None:
    """毫秒时间戳 → datetime。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        ts = value
        if ts > 1e12:  # 毫秒
            ts = ts / 1000
        return datetime.utcfromtimestamp(ts)
    return None


def extract_participants(value) -> list[dict]:
    """从飞书 Lookup(users) 字段提取参会人列表 → [{name, open_id}]。"""
    result = []
    users = []

    # Lookup 字段可能直接是 {users: [...]} 或者 [{name, id}]
    if isinstance(value, dict) and "users" in value:
        users = value["users"]
    elif isinstance(value, list):
        users = value

    for u in users:
        if isinstance(u, dict):
            name = u.get("name", u.get("en_name", ""))
            open_id = u.get("id", u.get("open_id", ""))
            if name or open_id:
                result.append({"name": name, "open_id": open_id})

    return result


def extract_chat_info(value) -> tuple[str, str]:
    """从飞书 GroupChat 字段提取群名和群ID → (chat_name, chat_id)。"""
    if isinstance(value, dict):
        return value.get("name", ""), value.get("id", value.get("chat_id", ""))
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            return first.get("name", ""), first.get("id", first.get("chat_id", ""))
    return "", ""


def extract_keywords(value) -> list[str]:
    """从 MultiSelect 字段提取关键词数组。"""
    if isinstance(value, list):
        return [str(v) for v in value if v]
    return []
