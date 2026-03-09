"""录音文字记录智能匹配 — 将云文档中的录音文字记录关联到对应会议。"""

import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

RECORDING_TITLE_PREFIXES = ["文字记录：", "文字记录:", "录音文字：", "录音文字:"]


def is_recording_document(title: str | None) -> bool:
    """判断文档标题是否为录音文字记录。"""
    if not title:
        return False
    return any(title.startswith(prefix) for prefix in RECORDING_TITLE_PREFIXES)


def extract_meeting_title(title: str) -> str:
    """从录音文档标题中提取对应的会议标题。"""
    for prefix in RECORDING_TITLE_PREFIXES:
        if title.startswith(prefix):
            return title[len(prefix):].strip()
    return title.strip()


async def match_recording_to_meeting(
    title: str,
    content_text: str,
    owner_id: str,
    db: AsyncSession,
) -> int | None:
    """尝试将录音文字记录匹配到已有会议。返回匹配的 communication.id 或 None。

    匹配策略（按优先级）：
    1. 标题完全匹配
    2. 标题包含匹配（会议标题包含录音标题或反之）
    """
    clean_title = extract_meeting_title(title)
    if not clean_title:
        return None

    # 策略 1: 标题完全匹配
    result = await db.execute(
        text("""
            SELECT id FROM communications
            WHERE comm_type = 'meeting'
              AND owner_id = :owner_id
              AND title = :title
            ORDER BY comm_time DESC NULLS LAST
            LIMIT 1
        """),
        {"owner_id": owner_id, "title": clean_title},
    )
    row = result.fetchone()
    if row:
        logger.info("录音匹配成功（完全匹配）: '%s' -> communication.id=%d", clean_title, row[0])
        return row[0]

    # 策略 2: 标题包含匹配
    result = await db.execute(
        text("""
            SELECT id, title FROM communications
            WHERE comm_type = 'meeting'
              AND owner_id = :owner_id
              AND (title ILIKE :pattern OR :clean_title ILIKE '%%' || title || '%%')
            ORDER BY comm_time DESC NULLS LAST
            LIMIT 1
        """),
        {"owner_id": owner_id, "pattern": f"%{clean_title}%", "clean_title": clean_title},
    )
    row = result.fetchone()
    if row:
        logger.info("录音匹配成功（包含匹配）: '%s' -> communication.id=%d (title='%s')", clean_title, row[0], row[1])
        return row[0]

    logger.info("录音匹配失败，将创建独立录音记录: '%s'", clean_title)
    return None


async def fill_meeting_transcript(
    meeting_id: int,
    transcript_text: str,
    db: AsyncSession,
) -> None:
    """将录音文字记录填充到对应会议的 transcript 字段。"""
    await db.execute(
        text("""
            UPDATE communications
            SET transcript = :transcript, updated_at = now()
            WHERE id = :id
        """),
        {"transcript": transcript_text, "id": meeting_id},
    )
    logger.info("已填充录音文字记录到 communication.id=%d", meeting_id)
