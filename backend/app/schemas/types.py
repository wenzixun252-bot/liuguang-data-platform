"""共享类型定义 — 确保 naive datetime 序列化时带 UTC 时区标记。"""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import PlainSerializer


def _serialize_utc(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


UTCDatetime = Annotated[datetime, PlainSerializer(_serialize_utc, return_type=str)]
UTCDatetimeOpt = Annotated[
    datetime | None, PlainSerializer(_serialize_utc, return_type=str | None)
]
