"""内容分块模型 — 长文本按段落/语义切分后的细粒度向量存储。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class ContentChunk(Base):
    """内容分块表：存储细粒度文本块及其向量，用于精排检索。"""

    __tablename__ = "content_chunks"
    __table_args__ = (
        Index("idx_chunk_content", "content_type", "content_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    content_id: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_vector = mapped_column(Vector(settings.embedding_dimension), nullable=True)
    token_count: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
