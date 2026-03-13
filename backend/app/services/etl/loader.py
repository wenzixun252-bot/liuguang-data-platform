"""ETL Load 模块 — Embedding 生成 + 附件下载提取 + 分块写入 + KG 自动触发。"""

import json
import logging
import os
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.asset import ETLDataSource, ETLSyncState
from app.services.etl.postprocessor import content_postprocessor
from app.services.etl.transformer import (
    TransformResult,
    TransformedCommunication,
    TransformedDocument,
)
from app.models.user import User
from app.services.feishu import feishu_client
from app.services.file_upload import FileUploadService

logger = logging.getLogger(__name__)

MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024  # 50MB


class AssetLoader:
    """数据加载器：生成 Embedding + Upsert + 分块写入 + KG 自动触发。"""

    async def load(
        self,
        transform_result: TransformResult,
        db: AsyncSession,
        user_access_token: str | None = None,
    ) -> int:
        records = transform_result.records
        if not records:
            return 0

        # 0. 查询数据源配置（默认标签 + 提取规则）
        default_tag_ids: list[int] = []
        extraction_rule_id: int | None = None
        ds_result = await db.execute(
            select(ETLDataSource).where(
                ETLDataSource.app_token == transform_result.app_token,
                ETLDataSource.table_id == transform_result.table_id,
            )
        )
        ds = ds_result.scalar_one_or_none()
        if ds:
            if ds.default_tag_ids:
                default_tag_ids = ds.default_tag_ids
            if ds.extraction_rule_id:
                extraction_rule_id = ds.extraction_rule_id

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

        # 1. 批量生成摘要 Embedding（原表 content_vector 用 summary 向量）
        embeddings: list[list[float] | None] = [None] * len(records)
        if settings.embedding_api_key and not settings.embedding_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                texts = []
                for r in records:
                    base = (r.summary or f"{getattr(r, 'title', '') or ''} {r.content_text[:500]}").strip()
                    ki = getattr(r, 'key_info', None)
                    if ki and isinstance(ki, dict):
                        ki_text = " ".join(f"{k}: {v}" for k, v in ki.items() if v)
                        base = f"{base} {ki_text}"
                    texts.append(base)
                embeddings = await llm_client.batch_generate_embeddings(texts)
                logger.info("摘要 Embedding 生成完成: %d 条", len(embeddings))
            except Exception as e:
                logger.warning("Embedding 生成失败，跳过向量写入: %s", e)
                embeddings = [None] * len(records)
        else:
            logger.info("Embedding API 未配置，跳过向量生成")

        # 2. 逐条 Upsert + 去重检测 + 分块写入
        loaded_count = 0
        for record, embedding in zip(records, embeddings):
            try:
                # 用 SAVEPOINT 包裹单条操作，失败时只回滚这一条，不影响整个事务
                async with db.begin_nested():
                    vector_str = f"[{','.join(str(v) for v in embedding)}]" if embedding else None

                    # 去重检测（入库后再检查，因为需要数据库中的 ID）
                    content_type = {
                        TransformedDocument: "document",
                        TransformedCommunication: "communication",
                    }.get(type(record), "document")

                    if isinstance(record, TransformedDocument):
                        await self._upsert_document(db, record, vector_str)
                    elif isinstance(record, TransformedCommunication):
                        await self._upsert_communication(db, record, vector_str)
                    else:
                        logger.warning("未知记录类型: %s", type(record))
                        continue

                    loaded_count += 1

                    # 查询刚 upsert 的记录 ID
                    table_name = {
                        "document": "documents",
                        "communication": "communications",
                    }.get(content_type, "documents")

                    id_result = await db.execute(
                        text(f"SELECT id FROM {table_name} WHERE feishu_record_id = :rid"),
                        {"rid": record.feishu_record_id},
                    )
                    id_row = id_result.fetchone()
                    record_id = id_row[0] if id_row else None

                    # 去重标记
                    if record_id and record.content_hash:
                        dup_of = await content_postprocessor.check_duplicate(
                            record.content_hash, content_type, record_id, db,
                        )
                        if dup_of:
                            await db.execute(
                                text(f"UPDATE {table_name} SET duplicate_of = :dup WHERE id = :id"),
                                {"dup": dup_of, "id": record_id},
                            )

                    # 写入分块
                    if record_id and hasattr(record, "chunks") and record.chunks:
                        await self._write_chunks(
                            db, content_type, record_id, record.chunks,
                        )

                    # 写入继承标签
                    if default_tag_ids and record_id:
                        await self._inherit_tags(
                            db, record.feishu_record_id, content_type, default_tag_ids
                        )

                    # 应用提取规则：对有 extraction_rule_id 的数据源执行关键信息提取
                    if extraction_rule_id and record_id and record.content_text:
                        try:
                            from app.services.etl.enricher import extract_key_info
                            key_info = await extract_key_info(
                                record.content_text, extraction_rule_id, db,
                                title=getattr(record, 'title', None),
                            )
                            table_name_for_update = "documents" if content_type == "document" else "communications"
                            await db.execute(
                                text(
                                    f"UPDATE {table_name_for_update} SET extraction_rule_id = :rule_id, "
                                    f"key_info = CAST(:key_info AS jsonb) WHERE id = :id"
                                ),
                                {
                                    "rule_id": extraction_rule_id,
                                    "key_info": json.dumps(key_info, ensure_ascii=False) if key_info else None,
                                    "id": record_id,
                                },
                            )
                        except Exception as e_extract:
                            logger.warning(
                                "提取规则应用失败 (record_id=%s, rule_id=%d): %s",
                                record.feishu_record_id, extraction_rule_id, e_extract,
                            )
            except Exception as e:
                logger.error(
                    "Upsert 失败 (record_id=%s): %s",
                    record.feishu_record_id,
                    e,
                )
                # begin_nested() 的 SAVEPOINT 已自动回滚，事务仍可继续

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

    # ── Upsert 方法 ──────────────────────────────────────

    @staticmethod
    async def _upsert_document(db: AsyncSession, r: TransformedDocument, vector_str: str | None) -> None:
        await db.execute(
            text("""
                INSERT INTO documents (
                    owner_id, source_type, source_platform, source_app_token, source_table_id,
                    feishu_record_id, title, content_text, content_vector,
                    summary, author, doc_category, source_url, uploader_name, uploaded_by,
                    keywords, sentiment,
                    quality_score, content_hash, parse_status, processed_at,
                    extra_fields,
                    feishu_created_at, feishu_updated_at, synced_at, created_at, updated_at
                ) VALUES (
                    :owner_id, 'cloud', :source_platform, :source_app_token, :source_table_id,
                    :feishu_record_id, :title, :content_text, :content_vector,
                    :summary, :author, :doc_category, :source_url, :uploader_name, :uploaded_by,
                    CAST(:keywords AS jsonb), :sentiment,
                    :quality_score, :content_hash, 'done', :processed_at,
                    CAST(:extra_fields AS jsonb),
                    :feishu_created_at, :feishu_updated_at,
                    now(), now(), now()
                )
                ON CONFLICT (feishu_record_id, owner_id) WHERE feishu_record_id IS NOT NULL DO UPDATE SET
                    content_text = EXCLUDED.content_text,
                    content_vector = EXCLUDED.content_vector,
                    title = EXCLUDED.title,
                    summary = EXCLUDED.summary,
                    author = EXCLUDED.author,
                    doc_category = EXCLUDED.doc_category,
                    source_url = EXCLUDED.source_url,
                    uploader_name = EXCLUDED.uploader_name,
                    uploaded_by = COALESCE(documents.uploaded_by, EXCLUDED.uploaded_by),
                    keywords = EXCLUDED.keywords,
                    sentiment = EXCLUDED.sentiment,
                    quality_score = EXCLUDED.quality_score,
                    content_hash = EXCLUDED.content_hash,
                    parse_status = EXCLUDED.parse_status,
                    processed_at = EXCLUDED.processed_at,
                    extra_fields = EXCLUDED.extra_fields,
                    feishu_updated_at = EXCLUDED.feishu_updated_at,
                    synced_at = now(),
                    updated_at = now()
            """),
            {
                "owner_id": r.owner_id,
                "source_platform": r.source_platform or "feishu",
                "source_app_token": r.source_app_token,
                "source_table_id": r.source_table_id,
                "feishu_record_id": r.feishu_record_id,
                "title": r.title,
                "content_text": r.content_text,
                "content_vector": vector_str,
                "summary": r.summary,
                "author": r.author,
                "doc_category": r.doc_category,
                "source_url": r.source_url or None,
                "uploader_name": r.uploader_name or None,
                "uploaded_by": r.uploaded_by or None,
                "keywords": _list_to_json(r.keywords),
                "sentiment": r.sentiment,
                "quality_score": r.quality_score,
                "content_hash": r.content_hash,
                "processed_at": r.processed_at,
                "extra_fields": _dict_to_json(r.extra_fields),
                "feishu_created_at": r.feishu_created_at,
                "feishu_updated_at": r.feishu_updated_at,
            },
        )

    @staticmethod
    async def _upsert_communication(db: AsyncSession, r: TransformedCommunication, vector_str: str | None) -> None:
        await db.execute(
            text("""
                INSERT INTO communications (
                    owner_id, source_platform, source_app_token, source_table_id,
                    feishu_record_id, comm_type, title, comm_time,
                    initiator, participants, duration_minutes,
                    location, agenda, conclusions, action_items,
                    transcript, recording_url,
                    chat_id, chat_type, chat_name,
                    message_type, reply_to,
                    content_text, content_vector,
                    summary, source_url, uploader_name, uploaded_by,
                    keywords, sentiment,
                    quality_score, content_hash, parse_status, processed_at,
                    extra_fields,
                    feishu_created_at, feishu_updated_at, synced_at, created_at, updated_at
                ) VALUES (
                    :owner_id, :source_platform, :source_app_token, :source_table_id,
                    :feishu_record_id, :comm_type, :title, :comm_time,
                    :initiator, CAST(:participants AS jsonb), :duration_minutes,
                    :location, :agenda, :conclusions, CAST(:action_items AS jsonb),
                    :transcript, :recording_url,
                    :chat_id, :chat_type, :chat_name,
                    :message_type, :reply_to,
                    :content_text, :content_vector,
                    :summary, :source_url, :uploader_name, :uploaded_by,
                    CAST(:keywords AS jsonb), :sentiment,
                    :quality_score, :content_hash, 'done', :processed_at,
                    CAST(:extra_fields AS jsonb),
                    :feishu_created_at, :feishu_updated_at,
                    now(), now(), now()
                )
                ON CONFLICT (feishu_record_id) WHERE feishu_record_id IS NOT NULL DO UPDATE SET
                    comm_type = EXCLUDED.comm_type,
                    title = EXCLUDED.title,
                    comm_time = EXCLUDED.comm_time,
                    initiator = EXCLUDED.initiator,
                    participants = EXCLUDED.participants,
                    duration_minutes = EXCLUDED.duration_minutes,
                    location = EXCLUDED.location,
                    agenda = EXCLUDED.agenda,
                    conclusions = EXCLUDED.conclusions,
                    action_items = EXCLUDED.action_items,
                    transcript = EXCLUDED.transcript,
                    recording_url = EXCLUDED.recording_url,
                    chat_id = EXCLUDED.chat_id,
                    chat_type = EXCLUDED.chat_type,
                    chat_name = EXCLUDED.chat_name,
                    message_type = EXCLUDED.message_type,
                    reply_to = EXCLUDED.reply_to,
                    content_text = EXCLUDED.content_text,
                    content_vector = EXCLUDED.content_vector,
                    summary = EXCLUDED.summary,
                    source_url = EXCLUDED.source_url,
                    uploader_name = EXCLUDED.uploader_name,
                    uploaded_by = COALESCE(communications.uploaded_by, EXCLUDED.uploaded_by),
                    keywords = EXCLUDED.keywords,
                    sentiment = EXCLUDED.sentiment,
                    quality_score = EXCLUDED.quality_score,
                    content_hash = EXCLUDED.content_hash,
                    parse_status = EXCLUDED.parse_status,
                    processed_at = EXCLUDED.processed_at,
                    extra_fields = EXCLUDED.extra_fields,
                    feishu_updated_at = EXCLUDED.feishu_updated_at,
                    synced_at = now(),
                    updated_at = now()
            """),
            {
                "owner_id": r.owner_id,
                "source_platform": r.source_platform or "feishu",
                "source_app_token": r.source_app_token,
                "source_table_id": r.source_table_id,
                "feishu_record_id": r.feishu_record_id,
                "comm_type": r.comm_type,
                "title": r.title,
                "comm_time": r.comm_time,
                "initiator": r.initiator,
                "participants": _list_to_json(r.participants),
                "duration_minutes": r.duration_minutes,
                "location": r.location,
                "agenda": r.agenda,
                "conclusions": r.conclusions,
                "action_items": _list_to_json(r.action_items),
                "transcript": r.transcript,
                "recording_url": r.recording_url or None,
                "chat_id": r.chat_id,
                "chat_type": r.chat_type,
                "chat_name": r.chat_name,
                "message_type": r.message_type,
                "reply_to": r.reply_to,
                "content_text": r.content_text,
                "content_vector": vector_str,
                "summary": r.summary,
                "source_url": r.source_url or None,
                "uploader_name": r.uploader_name or None,
                "uploaded_by": r.uploaded_by or None,
                "keywords": _list_to_json(r.keywords),
                "sentiment": r.sentiment,
                "quality_score": r.quality_score,
                "content_hash": r.content_hash,
                "processed_at": r.processed_at,
                "extra_fields": _dict_to_json(r.extra_fields),
                "feishu_created_at": r.feishu_created_at,
                "feishu_updated_at": r.feishu_updated_at,
            },
        )

    # ── 分块写入 ─────────────────────────────────────────

    @staticmethod
    async def _write_chunks(
        db: AsyncSession,
        content_type: str,
        content_id: int,
        chunks: list[str],
    ) -> None:
        """写入文本分块（先删后插，保证幂等）。"""
        # 清除旧分块
        await db.execute(
            text("DELETE FROM content_chunks WHERE content_type = :ct AND content_id = :cid"),
            {"ct": content_type, "cid": content_id},
        )

        # 批量生成分块 embedding
        chunk_embeddings: list[list[float] | None] = [None] * len(chunks)
        if settings.embedding_api_key and not settings.embedding_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                chunk_embeddings = await llm_client.batch_generate_embeddings(chunks)
            except Exception as e:
                logger.warning("分块 Embedding 生成失败: %s", e)

        # 逐块写入
        for idx, (chunk_text, chunk_emb) in enumerate(zip(chunks, chunk_embeddings)):
            vector_str = f"[{','.join(str(v) for v in chunk_emb)}]" if chunk_emb else None
            token_count = content_postprocessor.estimate_token_count(chunk_text)
            await db.execute(
                text("""
                    INSERT INTO content_chunks (content_type, content_id, chunk_index, chunk_text, chunk_vector, token_count)
                    VALUES (:ct, :cid, :idx, :text, :vec, :tc)
                """),
                {
                    "ct": content_type,
                    "cid": content_id,
                    "idx": idx,
                    "text": chunk_text,
                    "vec": vector_str,
                    "tc": token_count,
                },
            )

    # ── 标签继承 ─────────────────────────────────────────

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
            "communication": "communications",
        }.get(content_type)
        if not table_name:
            return

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

    # ── 附件处理 ─────────────────────────────────────────

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

        if attachment_texts:
            record.content_text = (
                record.content_text + "\n\n" + "\n\n".join(attachment_texts)
            ).strip()

        if attachment_metas:
            record.extra_fields["_attachments"] = attachment_metas

    # ── 同步状态更新 ─────────────────────────────────────

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
            # 查找数据源的 asset_type 来确定目标表
            ds_result = await db.execute(
                select(ETLDataSource).where(
                    ETLDataSource.app_token == app_token,
                    ETLDataSource.table_id == table_id,
                )
            )
            ds = ds_result.scalar_one_or_none()

            # 查询目标表的实际总记录数（累计值，而非仅本次同步数）
            total_count = records_synced
            if ds and ds.owner_id:
                try:
                    if ds.asset_type == "communication":
                        count_result = await db.execute(
                            text(
                                "SELECT COUNT(*) FROM communications "
                                "WHERE owner_id = :owner_id "
                                "AND source_app_token = :app_token "
                                "AND source_table_id = :table_id"
                            ),
                            {"owner_id": ds.owner_id, "app_token": app_token, "table_id": table_id},
                        )
                    else:
                        count_result = await db.execute(
                            text(
                                "SELECT COUNT(*) FROM documents "
                                "WHERE owner_id = :owner_id "
                                "AND source_app_token = :app_token "
                                "AND source_table_id = :table_id"
                            ),
                            {"owner_id": ds.owner_id, "app_token": app_token, "table_id": table_id},
                        )
                    total_count = count_result.scalar() or records_synced
                except Exception:
                    await db.rollback()
                    total_count = (sync_state.records_synced or 0) + records_synced

            sync_state.last_sync_status = "success"
            sync_state.records_synced = total_count
            sync_state.last_sync_time = datetime.utcnow()
            sync_state.error_message = None
            await db.commit()


def _dict_to_json(d: dict) -> str:
    return json.dumps(d, ensure_ascii=False, default=str)


def _list_to_json(lst: list) -> str:
    return json.dumps(lst, ensure_ascii=False, default=str)


# 模块级单例
asset_loader = AssetLoader()
