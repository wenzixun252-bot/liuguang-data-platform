"""飞书机器人入库任务模型 — 关联消息接收与卡片确认两次请求。"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BotMessageTask(Base):
    __tablename__ = "bot_message_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    open_id: Mapped[str] = mapped_column(String(64), index=True)
    message_id: Mapped[str] = mapped_column(String(128), unique=True)
    input_type: Mapped[str] = mapped_column(String(32))  # text / file / cloud_doc / bitable
    raw_content: Mapped[dict] = mapped_column(JSONB, default=dict)
    selected_asset_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    selected_extraction_rule_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    selected_cleaning_rule_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # LLM 智能路由的推荐理由
    llm_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 入库后的记录 ID 和类型（用于调整时删除旧记录）
    ingested_record_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ingested_record_type: Mapped[str | None] = mapped_column(String(32), nullable=True)  # document / communication / structured_table
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending / processing / done / failed / cancelled
    result_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
