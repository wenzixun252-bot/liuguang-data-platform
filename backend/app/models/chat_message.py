"""聊天消息模型。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("idx_chat_owner", "owner_id"),
        Index("idx_chat_id", "chat_id"),
        Index("idx_chat_sent_at", "sent_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_app_token: Mapped[str] = mapped_column(String(128), nullable=False)
    source_table_id: Mapped[str | None] = mapped_column(String(128))
    feishu_record_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    chat_id: Mapped[str | None] = mapped_column(String(256))
    sender: Mapped[str | None] = mapped_column(String(256))
    message_type: Mapped[str | None] = mapped_column(String(64))
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column()
    reply_to: Mapped[str | None] = mapped_column(String(128))
    mentions: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    uploader_name: Mapped[str | None] = mapped_column(String(256))
    content_vector = mapped_column(Vector(settings.embedding_dimension), nullable=True)
    extra_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    synced_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
