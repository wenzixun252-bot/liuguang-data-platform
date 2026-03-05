"""ETL Load 模块 — Embedding 生成 + 附件下载提取 + 三表路由 Upsert 入库。"""

import json
import logging
import os
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.asset import ETLDataSource, ETLSyncState
from app.services.etl.transformer import (
    TransformResult,
    TransformedChatMessage,
    TransformedDocument,
    TransformedMeeting,
)
from app.models.user import User
from app.services.feishu import feishu_client
from app.services.file_upload import FileUploadService

logger = logging.getLogger(__name__)

MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024  # 50MB


class AssetLoader:
    """数据加载器：生成 Embedding + Upsert 到对应业务表。"""

    async def load(
        self,
        transform_result: TransformResult,
        db: AsyncSession,
        user_access_token: str | None = None,
    ) -> int:
        records = transform_result.records
        if not records:
            return 0

        # 0. 查询数据源的默认标签 ID
        default_tag_ids: list[int] = []
        ds_result = await db.execute(
            select(ETLDataSource).where(
                ETLDataSource.app_token == transform_result.app_token,
                ETLDataSource.table_id == transform_result.table_id,
            )
        )
        ds = ds_result.scalar_one_or_none()
        if ds and ds.default_tag_ids:
            default_tag_ids = ds.default_tag_ids

        # 0. 处理附件：下载 → 存盘 → 提取文本 → 追加到 content_text
        for record in records:
            if hasattr(record, "attachments") and record.attachments:
                await self._process_attachments(record, user_access_token)

        # 0.5 解析 uploader_name：根据 owner_id 从 users 表查找实际飞书用户名
        owner_ids = {r.owner_id for r in records if r.owner_id}
        owner_name_map: dict[str, str] = {}
        for oid in owner_ids:
            result = await db.execute(
                select(User).where(User.feishu_open_id == oid)
            )
            user = result.scalar_one_or_none()
            if user and user.name:
                owner_name_map[oid] = user.name
        for record in records:
            if record.owner_id and record.owner_id in owner_name_map:
                record.uploader_name = owner_name_map[record.owner_id]

        # 1. 批量生成 Embedding
        embeddings: list[list[float] | None] = [None] * len(records)
        if settings.embedding_api_key and not settings.embedding_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                texts = [
                    f"{getattr(r, 'title', '') or ''} {r.content_text}".strip()
                    for r in records
                ]
                embeddings = await llm_client.batch_generate_embeddings(texts)
                logger.info("Embedding 生成完成: %d 条", len(embeddings))
            except Exception as e:
                logger.warning("Embedding 生成失败，跳过向量写入: %s", e)
                embeddings = [None] * len(records)
        else:
            logger.info("Embedding API 未配置，跳过向量生成")

        # 2. 逐条 Upsert（根据 target_table 路由）
        loaded_count = 0
        for record, embedding in zip(records, embeddings):
            try:
                vector_str = f"[{','.join(str(v) for v in embedding)}]" if embedding else None

                if isinstance(record, TransformedDocument):
                    await self._upsert_document(db, record, vector_str)
                elif isinstance(record, TransformedMeeting):
                    await self._upsert_meeting(db, record, vector_str)
                elif isinstance(record, TransformedChatMessage):
                    await self._upsert_chat_message(db, record, vector_str)
                else:
                    logger.warning("未知记录类型: %s", type(record))
                    continue

                loaded_count += 1

                # 写入继承标签
                if default_tag_ids:
                    content_type = {
                        TransformedDocument: "document",
                        TransformedMeeting: "meeting",
                        TransformedChatMessage: "chat_message",
                    }.get(type(record), "document")
                    await self._inherit_tags(
                        db, record.feishu_record_id, content_type, default_tag_ids
                    )
            except Exception as e:
                logger.error(
                    "Upsert 失败 (record_id=%s): %s",
                    record.feishu_record_id,
                    e,
                )

        await db.commit()

        # 3. 更新 sync_state
        await self._update_sync_state(
            db,
            transform_result.app_token,
            transform_result.table_id,
            loaded_count,
        )

        logger.info(
            "数据加载完成: %s/%s -> %s, 成功 %d/%d 条",
            transform_result.app_token,
            transform_result.table_id,
            transform_result.target_table,
            loaded_count,
            len(records),
        )
        return loaded_count

    @staticmethod
    async def _upsert_document(db: AsyncSession, r: TransformedDocument, vector_str: str | None) -> None:
        await db.execute(
            text("""
                INSERT INTO documents (
                    owner_id, source_type, source_app_token, source_table_id,
                    feishu_record_id, title, content_text, content_vector,
                    summary, author, tags, category, doc_url, uploader_name,
                    extra_fields,
                    feishu_created_at, feishu_updated_at, synced_at, created_at, updated_at
                ) VALUES (
                    :owner_id, 'cloud', :source_app_token, :source_table_id,
                    :feishu_record_id, :title, :content_text, :content_vector,
                    :summary, :author, CAST(:tags AS jsonb), :category, :doc_url, :uploader_name,
                    CAST(:extra_fields AS jsonb),
                    :feishu_created_at, :feishu_updated_at,
                    now(), now(), now()
                )
                ON CONFLICT (feishu_record_id) WHERE feishu_record_id IS NOT NULL DO UPDATE SET
                    content_text = EXCLUDED.content_text,
                    content_vector = EXCLUDED.content_vector,
                    title = EXCLUDED.title,
                    summary = EXCLUDED.summary,
                    author = EXCLUDED.author,
                    tags = EXCLUDED.tags,
                    category = EXCLUDED.category,
                    doc_url = EXCLUDED.doc_url,
                    uploader_name = EXCLUDED.uploader_name,
                    extra_fields = EXCLUDED.extra_fields,
                    feishu_updated_at = EXCLUDED.feishu_updated_at,
                    synced_at = now(),
                    updated_at = now()
            """),
            {
                "owner_id": r.owner_id,
                "source_app_token": r.source_app_token,
                "source_table_id": r.source_table_id,
                "feishu_record_id": r.feishu_record_id,
                "title": r.title,
                "content_text": r.content_text,
                "content_vector": vector_str,
                "summary": r.summary,
                "author": r.author,
                "tags": _dict_to_json(r.tags),
                "category": r.category,
                "doc_url": r.doc_url or None,
                "uploader_name": r.uploader_name or None,
                "extra_fields": _dict_to_json(r.extra_fields),
                "feishu_created_at": r.feishu_created_at,
                "feishu_updated_at": r.feishu_updated_at,
            },
        )

    @staticmethod
    async def _upsert_meeting(db: AsyncSession, r: TransformedMeeting, vector_str: str | None) -> None:
        await db.execute(
            text("""
                INSERT INTO meetings (
                    owner_id, source_app_token, source_table_id,
                    feishu_record_id, title, meeting_time, duration_minutes,
                    location, organizer, participants, agenda, conclusions,
                    action_items, content_text, content_vector,
                    minutes_url, uploader_name, extra_fields,
                    feishu_created_at, feishu_updated_at, synced_at, created_at, updated_at
                ) VALUES (
                    :owner_id, :source_app_token, :source_table_id,
                    :feishu_record_id, :title, :meeting_time, :duration_minutes,
                    :location, :organizer, CAST(:participants AS jsonb), :agenda, :conclusions,
                    CAST(:action_items AS jsonb), :content_text, :content_vector,
                    :minutes_url, :uploader_name, CAST(:extra_fields AS jsonb),
                    :feishu_created_at, :feishu_updated_at,
                    now(), now(), now()
                )
                ON CONFLICT (feishu_record_id) DO UPDATE SET
                    content_text = EXCLUDED.content_text,
                    content_vector = EXCLUDED.content_vector,
                    title = EXCLUDED.title,
                    meeting_time = EXCLUDED.meeting_time,
                    duration_minutes = EXCLUDED.duration_minutes,
                    location = EXCLUDED.location,
                    organizer = EXCLUDED.organizer,
                    participants = EXCLUDED.participants,
                    agenda = EXCLUDED.agenda,
                    conclusions = EXCLUDED.conclusions,
                    action_items = EXCLUDED.action_items,
                    minutes_url = EXCLUDED.minutes_url,
                    uploader_name = EXCLUDED.uploader_name,
                    extra_fields = EXCLUDED.extra_fields,
                    feishu_updated_at = EXCLUDED.feishu_updated_at,
                    synced_at = now(),
                    updated_at = now()
            """),
            {
                "owner_id": r.owner_id,
                "source_app_token": r.source_app_token,
                "source_table_id": r.source_table_id,
                "feishu_record_id": r.feishu_record_id,
                "title": r.title,
                "meeting_time": r.meeting_time,
                "duration_minutes": r.duration_minutes,
                "location": r.location,
                "organizer": r.organizer,
                "participants": _list_to_json(r.participants),
                "agenda": r.agenda,
                "conclusions": r.conclusions,
                "action_items": _list_to_json(r.action_items),
                "content_text": r.content_text,
                "content_vector": vector_str,
                "minutes_url": r.minutes_url or None,
                "uploader_name": r.uploader_name or None,
                "extra_fields": _dict_to_json(r.extra_fields),
                "feishu_created_at": r.feishu_created_at,
                "feishu_updated_at": r.feishu_updated_at,
            },
        )

    @staticmethod
    async def _upsert_chat_message(db: AsyncSession, r: TransformedChatMessage, vector_str: str | None) -> None:
        await db.execute(
            text("""
                INSERT INTO chat_messages (
                    owner_id, source_app_token, source_table_id,
                    feishu_record_id, chat_id, sender, message_type,
                    content_text, sent_at, reply_to, mentions,
                    uploader_name, content_vector, extra_fields,
                    synced_at, created_at, updated_at
                ) VALUES (
                    :owner_id, :source_app_token, :source_table_id,
                    :feishu_record_id, :chat_id, :sender, :message_type,
                    :content_text, :sent_at, :reply_to, CAST(:mentions AS jsonb),
                    :uploader_name, :content_vector, CAST(:extra_fields AS jsonb),
                    now(), now(), now()
                )
                ON CONFLICT (feishu_record_id) DO UPDATE SET
                    content_text = EXCLUDED.content_text,
                    content_vector = EXCLUDED.content_vector,
                    sender = EXCLUDED.sender,
                    message_type = EXCLUDED.message_type,
                    sent_at = EXCLUDED.sent_at,
                    reply_to = EXCLUDED.reply_to,
                    mentions = EXCLUDED.mentions,
                    uploader_name = EXCLUDED.uploader_name,
                    extra_fields = EXCLUDED.extra_fields,
                    synced_at = now(),
                    updated_at = now()
            """),
            {
                "owner_id": r.owner_id,
                "source_app_token": r.source_app_token,
                "source_table_id": r.source_table_id,
                "feishu_record_id": r.feishu_record_id,
                "chat_id": r.chat_id,
                "sender": r.sender,
                "message_type": r.message_type,
                "content_text": r.content_text,
                "sent_at": r.sent_at,
                "reply_to": r.reply_to,
                "mentions": _list_to_json(r.mentions),
                "uploader_name": r.uploader_name or None,
                "content_vector": vector_str,
                "extra_fields": _dict_to_json(r.extra_fields),
            },
        )

    @staticmethod
    async def _inherit_tags(
        db: AsyncSession,
        feishu_record_id: str,
        content_type: str,
        tag_ids: list[int],
    ) -> None:
        """将数据源的默认标签继承到同步的记录上。"""
        table_name = {
            "document": "documents",
            "meeting": "meetings",
            "chat_message": "chat_messages",
        }.get(content_type)
        if not table_name:
            return

        # 查询 upsert 后的记录 id
        result = await db.execute(
            text(f"SELECT id FROM {table_name} WHERE feishu_record_id = :rid"),
            {"rid": feishu_record_id},
        )
        row = result.fetchone()
        if not row:
            return

        content_id = row[0]
        for tag_id in tag_ids:
            await db.execute(
                text(
                    "INSERT INTO content_tags (tag_id, content_type, content_id, tagged_by) "
                    "VALUES (:tag_id, :content_type, :content_id, 'source_inherit') "
                    "ON CONFLICT (tag_id, content_type, content_id) DO NOTHING"
                ),
                {"tag_id": tag_id, "content_type": content_type, "content_id": content_id},
            )

    @staticmethod
    async def _process_attachments(record, user_access_token: str | None) -> None:
        """下载附件、提取文本、追加到 content_text，元信息写入 extra_fields._attachments。"""
        attachment_texts: list[str] = []
        attachment_metas: list[dict] = []

        for att in record.attachments:
            file_token = att.get("file_token", "")
            name = att.get("name", "unknown")
            size = att.get("size", 0)

            if not file_token:
                continue
            if size > MAX_ATTACHMENT_SIZE:
                logger.warning("附件过大，跳过: %s (%d bytes)", name, size)
                continue

            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""

            try:
                content_bytes = await feishu_client.download_media(
                    file_token, user_access_token=user_access_token,
                )
            except Exception as e:
                logger.warning("附件下载失败 (token=%s, name=%s): %s", file_token, name, e)
                continue

            # 存盘
            save_dir = os.path.join(
                settings.upload_dir, "attachments", record.owner_id,
            )
            os.makedirs(save_dir, exist_ok=True)
            save_path = os.path.join(save_dir, f"{file_token}.{ext}" if ext else file_token)
            try:
                with open(save_path, "wb") as f:
                    f.write(content_bytes)
            except Exception as e:
                logger.warning("附件存盘失败 (%s): %s", save_path, e)
                continue

            # 提取文本
            extracted = ""
            if ext:
                try:
                    extracted = FileUploadService._extract_text(content_bytes, ext)
                except Exception as e:
                    logger.warning("附件文本提取失败 (%s): %s", name, e)

            if extracted and extracted.strip():
                attachment_texts.append(f"[附件: {name}]\n{extracted.strip()}")

            attachment_metas.append({
                "file_token": file_token,
                "name": name,
                "size": len(content_bytes),
                "type": att.get("type", ""),
                "ext": ext,
                "file_path": save_path,
                "text_extracted": bool(extracted and extracted.strip()),
            })

            logger.info("附件处理完成: %s -> %s (%d bytes)", name, save_path, len(content_bytes))

        # 追加文本到 content_text
        if attachment_texts:
            record.content_text = (
                record.content_text + "\n\n" + "\n\n".join(attachment_texts)
            ).strip()

        # 元信息写入 extra_fields
        if attachment_metas:
            record.extra_fields["_attachments"] = attachment_metas

    @staticmethod
    async def _update_sync_state(
        db: AsyncSession,
        app_token: str,
        table_id: str,
        records_synced: int,
    ) -> None:
        result = await db.execute(
            select(ETLSyncState).where(
                ETLSyncState.source_app_token == app_token,
                ETLSyncState.source_table_id == table_id,
            )
        )
        sync_state = result.scalar_one_or_none()
        if sync_state:
            sync_state.last_sync_status = "success"
            sync_state.records_synced = records_synced
            sync_state.last_sync_time = datetime.utcnow()
            sync_state.error_message = None
            await db.commit()


def _dict_to_json(d: dict) -> str:
    return json.dumps(d, ensure_ascii=False, default=str)


def _list_to_json(lst: list) -> str:
    return json.dumps(lst, ensure_ascii=False, default=str)


# 模块级单例
asset_loader = AssetLoader()
