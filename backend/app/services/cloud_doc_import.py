"""飞书云文档/文件导入服务 — 云文档通过 Block API 读取，飞书文件通过下载后本地提取。"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.document import Document
from app.models.communication import Communication
from app.services.feishu import feishu_client, FeishuAPIError

logger = logging.getLogger(__name__)

# 飞书文件中支持本地文本提取的扩展名
EXTRACTABLE_FILE_EXTENSIONS = {"pdf", "docx", "doc", "txt", "csv", "xlsx", "xls", "pptx", "ppt"}
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}


@dataclass
class ImportResult:
    """批量导入结果统计。"""
    imported: int = 0
    skipped: int = 0
    failed: int = 0
    documents: list = field(default_factory=list)
    errors: list = field(default_factory=list)  # [{"name": "文件名", "reason": "错误原因"}]


class CloudDocImportService:
    """飞书云文档/文件导入服务。"""

    async def _resolve_wiki_owners(
        self,
        file_infos: list[dict],
        db: AsyncSession,
        user_access_token: str,
    ) -> None:
        """为 wiki 类型文档解析真实的 owner 信息（原地修改 file_infos）。

        wiki 文档的 token 在 batch_get_doc_meta 中无法查到 owner，
        需要先通过 get_wiki_node_info 解析出 obj_token/obj_type，
        再用 obj_token 查 meta 获取真实所有者。
        """
        wiki_files = [
            f for f in file_infos
            if f.get("type") == "wiki" and f.get("token")
            and (not f.get("owner_id") or not f.get("owner_name"))
        ]
        if not wiki_files:
            return

        # 1. 并发解析 wiki node → obj_token
        async def _resolve(tok: str):
            try:
                node = await feishu_client.get_wiki_node_info(tok, user_access_token=user_access_token)
                return tok, node.get("obj_token", ""), node.get("obj_type", "docx")
            except Exception:
                return tok, "", ""

        resolved = await asyncio.gather(*[_resolve(wf["token"]) for wf in wiki_files[:50]])
        wiki_obj_map: dict[str, dict] = {}
        for wt, obj_tok, obj_typ in resolved:
            if obj_tok:
                wiki_obj_map[wt] = {"obj_token": obj_tok, "obj_type": obj_typ}

        if not wiki_obj_map:
            return

        # 2. 用 obj_token 查 batch_get_doc_meta 获取 owner
        try:
            obj_to_wiki = {}  # obj_token -> wiki_token
            meta_docs = []
            for wiki_tok, obj_info in wiki_obj_map.items():
                meta_docs.append({"token": obj_info["obj_token"], "type": obj_info["obj_type"]})
                obj_to_wiki[obj_info["obj_token"]] = wiki_tok
            meta_map = await feishu_client.batch_get_doc_meta(meta_docs, user_access_token)
            for obj_tok, wiki_tok in obj_to_wiki.items():
                meta = meta_map.get(obj_tok, {})
                wf = next((f for f in wiki_files if f["token"] == wiki_tok), None)
                if wf and meta:
                    if meta.get("owner_id") and not wf.get("owner_id"):
                        wf["owner_id"] = meta["owner_id"]
                    if meta.get("owner_name") and not wf.get("owner_name"):
                        wf["owner_name"] = meta["owner_name"]
        except Exception as e:
            logger.warning("wiki 文档 batch_get_doc_meta 补充 owner 失败: %s", e)

        # 3. 如果 meta 没有 owner_name 但有 owner_id，查 User 表兜底
        still_need = [f for f in wiki_files if f.get("owner_id") and not f.get("owner_name")]
        if still_need:
            try:
                from app.models.user import User
                unique_oids = list({f["owner_id"] for f in still_need})
                user_rows = (await db.execute(
                    select(User.feishu_open_id, User.name).where(
                        User.feishu_open_id.in_(unique_oids)
                    )
                )).all()
                name_map = {r.feishu_open_id: r.name for r in user_rows if r.name}
                for f in still_need:
                    resolved_name = name_map.get(f["owner_id"])
                    if resolved_name:
                        f["owner_name"] = resolved_name
            except Exception as e:
                logger.warning("wiki 文档 User 表解析 owner_name 失败: %s", e)

        # 4. User 表查不到的，通过飞书 Contact API 兜底
        wiki_final = [f for f in wiki_files if f.get("owner_id") and not f.get("owner_name")]
        if wiki_final:
            try:
                unique_oids = list({f["owner_id"] for f in wiki_final})
                feishu_name_map = await feishu_client.batch_get_user_names(unique_oids)
                for f in wiki_final:
                    resolved_name = feishu_name_map.get(f["owner_id"])
                    if resolved_name:
                        f["owner_name"] = resolved_name
            except Exception as e:
                logger.warning("wiki 文档飞书 Contact API 解析 owner_name 失败: %s", e)

    async def import_cloud_doc(
        self,
        document_id: str,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        asset_owner_name: str | None = None,
        force: bool = False,
        feishu_owner_id: str | None = None,
        source_platform: str = "feishu_cloud_doc",
    ) -> tuple[Document | None, str]:
        """导入飞书云文档（docx/doc 类型），通过 Block API 读取内容。

        Args:
            asset_owner_name: 资产所有人显示名（飞书文档原始作者） → 写入 DB asset_owner_name 列

        Returns:
            (Document, status) — status: "imported" | "skipped" | "failed"
        """
        try:
            # 1. 检查是否已导入
            existing = await self._find_existing(db, document_id, owner_id)
            if existing and not force:
                # 回补资产所有人显示名（老数据可能缺失）
                changed = False
                if asset_owner_name and existing.asset_owner_name != asset_owner_name:
                    existing.asset_owner_name = asset_owner_name
                    changed = True
                # 回补 feishu_created_at / feishu_updated_at（老数据可能缺失）
                if not existing.feishu_created_at or not existing.feishu_updated_at:
                    try:
                        meta_map = await feishu_client.batch_get_doc_meta(
                            [{"token": document_id, "type": "docx"}],
                            user_access_token,
                        )
                        meta = meta_map.get(document_id, {})
                        if meta.get("create_time") and not existing.feishu_created_at:
                            existing.feishu_created_at = datetime.utcfromtimestamp(int(meta["create_time"]))
                            changed = True
                        if meta.get("latest_modify_time") and not existing.feishu_updated_at:
                            existing.feishu_updated_at = datetime.utcfromtimestamp(int(meta["latest_modify_time"]))
                            changed = True
                    except Exception as e:
                        logger.debug("回补云文档时间戳失败 [%s]: %s", document_id, e)
                if changed:
                    await db.commit()
                logger.info("云文档已导入，跳过: %s", document_id)
                return existing, "skipped"

            # 2. 通过 Block API 获取文档内容
            doc_content = await feishu_client.get_document_content(
                document_id, user_access_token=user_access_token,
            )
            title = doc_content["title"]
            content_text = doc_content["content_text"]

            if not content_text.strip():
                content_text = f"[空文档] {title}"

            # 3. 对已存在的文档检查是否有更新
            if existing and not force:
                modified_time = doc_content.get("modified_time")
                if modified_time and existing.feishu_updated_at:
                    new_ts = datetime.utcfromtimestamp(int(modified_time))
                    if new_ts <= existing.feishu_updated_at:
                        logger.info("云文档未更新，跳过: %s", document_id)
                        return existing, "skipped"

            # 4. LLM 结构化解析
            parsed = await self._llm_parse(content_text, "docx")

            # 5. 生成 Embedding
            embedding = await self._generate_embedding(title, content_text)

            # 6. 构建文档 URL
            domain = settings.feishu_base_domain or "feishu.cn"
            source_url = f"https://{domain}/docx/{document_id}"

            # 7. 构建时间戳（Block API 优先，batch_get_doc_meta 兜底）
            created_time = doc_content.get("created_time")
            modified_time = doc_content.get("modified_time")
            if not created_time or not modified_time:
                try:
                    meta_map = await feishu_client.batch_get_doc_meta(
                        [{"token": document_id, "type": "docx"}],
                        user_access_token,
                    )
                    meta = meta_map.get(document_id, {})
                    if not created_time and meta.get("create_time"):
                        created_time = meta["create_time"]
                    if not modified_time and meta.get("latest_modify_time"):
                        modified_time = meta["latest_modify_time"]
                except Exception as e:
                    logger.debug("batch_get_doc_meta 获取时间失败 [%s]: %s", document_id, e)
            feishu_created = datetime.utcfromtimestamp(int(created_time)) if created_time else None
            feishu_updated = datetime.utcfromtimestamp(int(modified_time)) if modified_time else None

            # 8. Upsert
            keywords_list = parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else []

            if existing:
                # 更新现有记录
                existing.title = parsed.get("title") or title
                existing.original_filename = title
                existing.content_text = content_text
                existing.summary = parsed.get("summary")
                existing.author = parsed.get("author")
                existing.keywords = keywords_list
                existing.source_url = source_url
                existing.feishu_created_at = feishu_created
                existing.feishu_updated_at = feishu_updated
                existing.synced_at = datetime.utcnow()
                if asset_owner_name:
                    existing.asset_owner_name = asset_owner_name
                if embedding:
                    existing.content_vector = embedding
                await db.commit()
                await db.refresh(existing)
                logger.info("云文档已更新: doc_id=%d, title=%s", existing.id, existing.title)
                return existing, "imported"
            else:
                doc = Document(
                    owner_id=owner_id,
                    source_type="cloud",
                    source_platform=source_platform,
                    feishu_record_id=document_id,
                    original_filename=title,
                    title=parsed.get("title") or title,
                    content_text=content_text,
                    summary=parsed.get("summary"),
                    author=parsed.get("author"),
                    keywords=keywords_list,
                    file_type="docx",
                    source_url=source_url,
                    asset_owner_name=asset_owner_name,
                    feishu_created_at=feishu_created,
                    feishu_updated_at=feishu_updated,
                    synced_at=datetime.utcnow(),
                )
                if embedding:
                    doc.content_vector = embedding
                db.add(doc)
                await db.commit()
                await db.refresh(doc)
                logger.info("云文档已导入: doc_id=%d, title=%s", doc.id, doc.title)
                return doc, "imported"

        except Exception as e:
            logger.error("导入云文档失败 [%s]: %s", document_id, e)
            return None, "failed"

    async def import_cloud_file(
        self,
        file_token: str,
        file_name: str,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        asset_owner_name: str | None = None,
        force: bool = False,
        feishu_owner_id: str | None = None,
        source_platform: str = "feishu_cloud_doc",
        created_time: str | int | None = None,
        modified_time: str | int | None = None,
    ) -> tuple[Document | None, str]:
        """导入飞书文件（PDF/PPT 等），先下载再本地提取文本。

        Args:
            asset_owner_name: 资产所有人显示名 → DB asset_owner_name 列

        Returns:
            (Document, status) — status: "imported" | "skipped" | "failed"
        """
        try:
            # 1. 检查是否已导入
            existing = await self._find_existing(db, file_token, owner_id)
            if existing and not force:
                # 回补资产所有人显示名（老数据可能缺失）
                changed = False
                if asset_owner_name and existing.asset_owner_name != asset_owner_name:
                    existing.asset_owner_name = asset_owner_name
                    changed = True
                # 回补 feishu_created_at / feishu_updated_at（老数据可能缺失）
                if not existing.feishu_created_at or not existing.feishu_updated_at:
                    try:
                        ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
                        doc_type = ext if ext in ("docx", "doc") else "file"
                        meta_map = await feishu_client.batch_get_doc_meta(
                            [{"token": file_token, "type": doc_type}],
                            user_access_token,
                        )
                        meta = meta_map.get(file_token, {})
                        if meta.get("create_time") and not existing.feishu_created_at:
                            existing.feishu_created_at = datetime.utcfromtimestamp(int(meta["create_time"]))
                            changed = True
                        if meta.get("latest_modify_time") and not existing.feishu_updated_at:
                            existing.feishu_updated_at = datetime.utcfromtimestamp(int(meta["latest_modify_time"]))
                            changed = True
                    except Exception as e:
                        logger.debug("回补飞书文件时间戳失败 [%s]: %s", file_token, e)
                if changed:
                    await db.commit()
                logger.info("飞书文件已导入，跳过: %s", file_token)
                return existing, "skipped"

            # 2. 获取文件扩展名
            ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
            # 飞书 Drive 返回的文件名可能不带扩展名，此时尝试当作通用文件处理
            if ext == file_name.lower() or not ext:
                ext = ""
                logger.info("文件 %s 无法识别扩展名，将尝试通用处理", file_name)
            if ext and ext not in EXTRACTABLE_FILE_EXTENSIONS and ext not in IMAGE_EXTENSIONS:
                logger.warning("不支持的文件类型: %s (%s)", file_name, ext)
                return None, "failed"

            # 3. 下载文件（Drive 文件用 download_drive_file，不是 download_media）
            content_bytes = await feishu_client.download_drive_file(
                file_token, user_access_token=user_access_token,
            )
            file_size = len(content_bytes)
            logger.info("文件已下载: %s (%d bytes)", file_name, file_size)

            # 4. 提取文本 & LLM 解析
            is_image = ext in IMAGE_EXTENSIONS
            parsed = {"title": file_name, "summary": None, "author": None, "tags": [], "category": None}

            if is_image:
                parsed, content_text = await self._parse_image(content_bytes, ext, file_name)
            elif ext:
                content_text = self._extract_text(content_bytes, ext)
                # PDF 特殊处理：pypdf 提取为空说明是扫描件，用视觉模型 OCR
                if ext == "pdf" and not content_text.strip():
                    content_text = await self._ocr_pdf_fallback(content_bytes, file_name)
                if not content_text.strip():
                    content_text = f"[{ext} 文件] {file_name}"
                parsed = await self._llm_parse(content_text, ext)
            else:
                # 无扩展名，尝试根据内容头部判断格式
                ext = self._guess_extension(content_bytes) or "bin"
                if ext in EXTRACTABLE_FILE_EXTENSIONS:
                    content_text = self._extract_text(content_bytes, ext)
                    if ext == "pdf" and not content_text.strip():
                        content_text = await self._ocr_pdf_fallback(content_bytes, file_name)
                else:
                    content_text = content_bytes.decode("utf-8", errors="replace")[:10000]
                if not content_text.strip():
                    content_text = f"[文件] {file_name}"
                parsed = await self._llm_parse(content_text, ext)

            # 5. 生成 Embedding
            embedding = await self._generate_embedding(
                parsed.get("title") or file_name, content_text,
            )

            # 6. 构建文档 URL
            domain = settings.feishu_base_domain or "feishu.cn"
            source_url = f"https://{domain}/file/{file_token}"

            # 7. 获取文件创建/修改时间
            feishu_created = None
            feishu_updated = None
            if created_time or modified_time:
                # 从 file_info 传入的时间戳
                feishu_created = datetime.utcfromtimestamp(int(created_time)) if created_time else None
                feishu_updated = datetime.utcfromtimestamp(int(modified_time)) if modified_time else None
            else:
                # 调用 batch_get_doc_meta 获取时间
                try:
                    doc_type = ext if ext in ("docx", "doc") else "file"
                    meta_map = await feishu_client.batch_get_doc_meta(
                        [{"token": file_token, "type": doc_type}],
                        user_access_token,
                    )
                    meta = meta_map.get(file_token, {})
                    if meta.get("create_time"):
                        feishu_created = datetime.utcfromtimestamp(int(meta["create_time"]))
                    if meta.get("latest_modify_time"):
                        feishu_updated = datetime.utcfromtimestamp(int(meta["latest_modify_time"]))
                except Exception as e:
                    logger.debug("获取文件元数据时间失败 [%s]: %s", file_token, e)

            # 8. Upsert
            keywords_list = parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else []

            if existing:
                existing.title = parsed.get("title") or file_name
                existing.original_filename = file_name
                existing.content_text = content_text
                existing.summary = parsed.get("summary")
                existing.author = parsed.get("author")
                existing.keywords = keywords_list
                existing.file_type = ext
                existing.file_size = file_size
                existing.source_url = source_url
                existing.feishu_created_at = feishu_created
                existing.feishu_updated_at = feishu_updated
                existing.synced_at = datetime.utcnow()
                if asset_owner_name:
                    existing.asset_owner_name = asset_owner_name
                if embedding:
                    existing.content_vector = embedding
                await db.commit()
                await db.refresh(existing)
                logger.info("飞书文件已更新: doc_id=%d, title=%s", existing.id, existing.title)
                return existing, "imported"
            else:
                doc = Document(
                    owner_id=owner_id,
                    source_type="cloud",
                    source_platform=source_platform,
                    feishu_record_id=file_token,
                    original_filename=file_name,
                    title=parsed.get("title") or file_name,
                    content_text=content_text,
                    summary=parsed.get("summary"),
                    author=parsed.get("author"),
                    keywords=keywords_list,
                    file_type=ext,
                    file_size=file_size,
                    source_url=source_url,
                    asset_owner_name=asset_owner_name,
                    feishu_created_at=feishu_created,
                    feishu_updated_at=feishu_updated,
                    synced_at=datetime.utcnow(),
                )
                if embedding:
                    doc.content_vector = embedding
                db.add(doc)
                await db.commit()
                await db.refresh(doc)
                logger.info("飞书文件已导入: doc_id=%d, title=%s", doc.id, doc.title)
                return doc, "imported"

        except Exception as e:
            logger.error("导入飞书文件失败 [%s]: %s", file_token, e)
            return None, "failed"

    async def import_item(
        self,
        file_info: dict,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        force: bool = False,
        source_platform: str = "feishu_cloud_doc",
    ) -> tuple[Document | None, str]:
        """路由方法 — 根据文件类型分发到不同处理逻辑。

        Args:
            file_info: 飞书 Drive API 返回的文件信息，包含 token, name, type, owner_name 等
        """
        file_type = file_info.get("type", "")
        token = file_info.get("token", "")
        name = file_info.get("name", "未命名")
        feishu_owner_id = file_info.get("owner_id", "") or None
        # 资产所有人显示名：使用文档原始所有者
        logger.info("import_item [%s] feishu_owner_id=%s, owner_name=%s, importer=%s",
                     name, feishu_owner_id, file_info.get("owner_name", ""), owner_id)
        display_owner = file_info.get("owner_name", "") or None
        # 飞书文件的创建/修改时间（从 list API 获取）
        fi_created_time = file_info.get("created_time")
        fi_modified_time = file_info.get("modified_time")

        if file_type in ("docx", "doc"):
            return await self.import_cloud_doc(
                token, owner_id, db, user_access_token, display_owner, force=force,
                feishu_owner_id=feishu_owner_id, source_platform=source_platform,
            )
        elif file_type == "file":
            return await self.import_cloud_file(
                token, name, owner_id, db, user_access_token, display_owner, force=force,
                feishu_owner_id=feishu_owner_id, source_platform=source_platform,
                created_time=fi_created_time, modified_time=fi_modified_time,
            )
        elif file_type == "wiki":
            # wiki 节点需要先解析实际类型
            try:
                node = await feishu_client.get_wiki_node_info(token, user_access_token=user_access_token)
                obj_type = node.get("obj_type", "")
                obj_token = node.get("obj_token", token)

                # wiki 文档的 owner 信息经常缺失，用解析后的 obj_token 补充
                if not feishu_owner_id or not display_owner:
                    try:
                        meta_map = await feishu_client.batch_get_doc_meta(
                            [{"token": obj_token, "type": obj_type or "docx"}],
                            user_access_token,
                        )
                        meta = meta_map.get(obj_token, {})
                        if meta.get("owner_id"):
                            feishu_owner_id = meta["owner_id"]
                        if meta.get("owner_name"):
                            display_owner = meta["owner_name"]
                        elif meta.get("owner_id"):
                            from app.models.user import User
                            row = (await db.execute(
                                select(User.name).where(User.feishu_open_id == meta["owner_id"])
                            )).scalar_one_or_none()
                            if row:
                                display_owner = row
                    except Exception as e:
                        logger.debug("wiki 文档 owner 补充失败 [%s]: %s", token, e)

                if obj_type in ("docx", "doc"):
                    return await self.import_cloud_doc(
                        obj_token, owner_id, db, user_access_token, display_owner, force=force,
                        feishu_owner_id=feishu_owner_id, source_platform=source_platform,
                    )
                elif obj_type == "file":
                    return await self.import_cloud_file(
                        obj_token, name, owner_id, db, user_access_token, display_owner, force=force,
                        feishu_owner_id=feishu_owner_id, source_platform=source_platform,
                    )
                else:
                    logger.warning("wiki 节点实际类型不支持导入: %s (%s → %s)", name, token, obj_type)
                    return None, "failed"
            except Exception as e:
                logger.warning("wiki 节点解析失败: %s (%s): %s", name, token, e)
                return None, "failed"
        else:
            logger.warning("不支持的飞书文件类型: %s (%s)", name, file_type)
            return None, "failed"

    async def fast_import_item(
        self,
        file_info: dict,
        owner_id: str,
        db: AsyncSession,
        tag_ids: list[int] | None = None,
        source_platform: str = "feishu_cloud_doc",
    ) -> tuple[Document | None, str]:
        """快速导入 — 仅保存文档元数据，不调用飞书内容 API 和 LLM。

        新导入的文档 parse_status 设为 "pending"，后台任务会异步处理内容解析和向量生成。
        """
        token = file_info.get("token", "")
        name = file_info.get("name", "未命名")
        doc_type = file_info.get("type", "docx")
        url = file_info.get("url", "")
        feishu_owner_id = file_info.get("owner_id", "") or None
        # 资产所有人显示名：使用文档原始所有者
        display_owner = file_info.get("owner_name", "") or None
        # 飞书文件的创建/修改时间
        fi_created_time = file_info.get("created_time")
        fi_modified_time = file_info.get("modified_time")
        feishu_created = datetime.utcfromtimestamp(int(fi_created_time)) if fi_created_time else None
        feishu_updated = datetime.utcfromtimestamp(int(fi_modified_time)) if fi_modified_time else None

        if not token:
            return None, "failed"

        try:
            existing = await self._find_existing(db, token, owner_id)
            if existing:
                # 回补资产所有人显示名（老数据可能缺失）
                if display_owner and existing.asset_owner_name != display_owner:
                    existing.asset_owner_name = display_owner
                    await db.commit()
                    await db.refresh(existing)
                # 回补 feishu_created_at / feishu_updated_at（老数据可能缺失）
                if feishu_created and not existing.feishu_created_at:
                    existing.feishu_created_at = feishu_created
                    await db.commit()
                    await db.refresh(existing)
                if feishu_updated and not existing.feishu_updated_at:
                    existing.feishu_updated_at = feishu_updated
                    await db.commit()
                    await db.refresh(existing)
                if tag_ids:
                    await self._apply_tags(existing.id, tag_ids, db)
                return existing, "skipped"

            if not url:
                domain = settings.feishu_base_domain or "feishu.cn"
                url = f"https://{domain}/docx/{token}"

            doc = Document(
                owner_id=owner_id,
                source_type="cloud",
                source_platform=source_platform,
                feishu_record_id=token,
                original_filename=name,
                title=name,
                content_text="",
                file_type=doc_type,
                source_url=url,
                asset_owner_name=display_owner,
                feishu_created_at=feishu_created,
                feishu_updated_at=feishu_updated,
                parse_status="pending",
                synced_at=datetime.utcnow(),
            )
            db.add(doc)
            await db.commit()
            await db.refresh(doc)

            if tag_ids:
                await self._apply_tags(doc.id, tag_ids, db)

            logger.info("快速导入文档元数据: token=%s, title=%s", token, name)
            return doc, "imported"

        except Exception as e:
            logger.error("快速导入失败 [%s]: %s", token, e)
            return None, "failed"

    async def batch_import(
        self,
        file_infos: list[dict],
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        tag_ids: list[int] | None = None,
        source_platform: str = "feishu_cloud_doc",
    ) -> ImportResult:
        """批量导入多个云文档/文件，QPS 控制。

        Args:
            tag_ids: 导入成功后自动打上的标签 ID 列表（来自关键词规则的 default_tag_ids）
        """
        PER_FILE_TIMEOUT = 90  # 单文件超时 90 秒

        # wiki 类型文档需要特殊处理：先解析 obj_token 再查 owner
        await self._resolve_wiki_owners(file_infos, db, user_access_token)

        # 补充非 wiki 文档的 owner_id / owner_name
        need_meta = [
            f for f in file_infos
            if f.get("token") and f.get("type") != "wiki"
            and (not f.get("owner_id") or not f.get("owner_name"))
        ]
        if need_meta:
            try:
                meta_map = await feishu_client.batch_get_doc_meta(
                    [{"token": f["token"], "type": f.get("type", "docx")} for f in need_meta],
                    user_access_token,
                )
                for f in need_meta:
                    meta = meta_map.get(f["token"])
                    if meta:
                        if not f.get("owner_id") and meta.get("owner_id"):
                            f["owner_id"] = meta["owner_id"]
                        if not f.get("owner_name") and meta.get("owner_name"):
                            f["owner_name"] = meta["owner_name"]
            except Exception as e:
                logger.warning("batch_get_doc_meta 补充 owner 信息失败: %s", e)

        # 飞书 batch_query API 不返回 asset_owner_name，通过 owner_id 查 User 表解析
        still_need_name = [f for f in file_infos if f.get("owner_id") and not f.get("owner_name")]
        if still_need_name:
            try:
                from app.models.user import User
                unique_oids = list({f["owner_id"] for f in still_need_name})
                user_rows = (await db.execute(
                    select(User.feishu_open_id, User.name).where(
                        User.feishu_open_id.in_(unique_oids)
                    )
                )).all()
                name_map = {r.feishu_open_id: r.name for r in user_rows if r.name}
                for f in still_need_name:
                    resolved = name_map.get(f["owner_id"])
                    if resolved:
                        f["owner_name"] = resolved
            except Exception as e:
                logger.warning("User 表解析 owner_name 失败: %s", e)

        # User 表查不到的，通过飞书 Contact API 兜底获取用户名
        final_need = [f for f in file_infos if f.get("owner_id") and not f.get("owner_name")]
        if final_need:
            try:
                unique_oids = list({f["owner_id"] for f in final_need})
                feishu_name_map = await feishu_client.batch_get_user_names(unique_oids)
                for f in final_need:
                    resolved = feishu_name_map.get(f["owner_id"])
                    if resolved:
                        f["owner_name"] = resolved
            except Exception as e:
                logger.warning("飞书 Contact API 解析 owner_name 失败: %s", e)

        result = ImportResult()

        for info in file_infos:
            name = info.get("name", "未命名")
            token = info.get("token", "")
            try:
                doc, status = await asyncio.wait_for(
                    self.import_item(
                        info, owner_id, db, user_access_token,
                        source_platform=source_platform,
                    ),
                    timeout=PER_FILE_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning("单文件导入超时（%ds）: %s (%s)", PER_FILE_TIMEOUT, name, token)
                result.failed += 1
                continue

            if status == "imported":
                result.imported += 1
                if doc:
                    result.documents.append(doc)
                    if tag_ids:
                        await self._apply_tags(doc.id, tag_ids, db)
                    # LLM 自动标签推荐
                    try:
                        from app.services.llm import auto_tag_content
                        content = doc.summary or (doc.content_text or "")[:2000]
                        tagged = await auto_tag_content(db, doc.id, "document", content, owner_id)
                        if tagged:
                            await db.commit()
                    except Exception:
                        pass
            elif status == "skipped":
                result.skipped += 1
                if doc:
                    result.documents.append(doc)
                    if tag_ids:
                        await self._apply_tags(doc.id, tag_ids, db)
            else:
                result.failed += 1

            # QPS 控制
            await asyncio.sleep(0.5)

        return result

    async def import_cloud_doc_as_communication(
        self,
        document_id: str,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        asset_owner_name: str | None = None,
        force: bool = False,
        feishu_owner_id: str | None = None,
    ) -> tuple[Communication | None, str]:
        """导入飞书云文档为沟通资产（会议纪要/文字记录），使用 LLM 智能提取字段。

        Returns:
            (Communication, status) — status: "imported" | "skipped" | "failed"
        """
        try:
            # 1. 检查是否已导入（通过 feishu_record_id 去重）
            existing = await self._find_existing_communication(db, document_id, owner_id)
            if existing and not force:
                logger.info("云文档已导入为沟通资产，跳过: %s", document_id)
                return existing, "skipped"

            # 2. 通过 Block API 获取文档内容
            doc_content = await feishu_client.get_document_content(
                document_id, user_access_token=user_access_token,
            )
            title = doc_content["title"]
            content_text = doc_content["content_text"]

            if not content_text.strip():
                content_text = f"[空文档] {title}"

            # 3. LLM 提取沟通资产字段
            parsed = await self._llm_parse_communication(content_text)

            # 4. 生成 Embedding
            embedding = await self._generate_embedding(title, content_text)

            # 5. 构建文档 URL（用于从沟通资产跳转回原云文档）
            domain = settings.feishu_base_domain or "feishu.cn"
            source_url = f"https://{domain}/docx/{document_id}"

            # 6. 构建时间戳
            created_time = doc_content.get("created_time")
            modified_time = doc_content.get("modified_time")
            feishu_created = datetime.utcfromtimestamp(int(created_time)) if created_time else None
            feishu_updated = datetime.utcfromtimestamp(int(modified_time)) if modified_time else None

            # 7. 解析 comm_time — 只存实际会议/录音时间，提取不到就留 None
            from datetime import timedelta
            now = datetime.utcnow()
            comm_time = None
            if parsed.get("comm_time"):
                try:
                    dt = datetime.fromisoformat(parsed["comm_time"])
                    if dt.tzinfo is not None:
                        # 转为 UTC naive（数据库统一存 UTC）
                        dt = dt.astimezone(tz=None).replace(tzinfo=None)
                        dt = datetime.utcfromtimestamp(dt.timestamp())
                    # 合理性校验：不应早于2年前或超过未来1天
                    if (now - timedelta(days=730)) <= dt <= (now + timedelta(days=1)):
                        comm_time = dt
                    else:
                        logger.warning(
                            "LLM 提取的 comm_time 不合理 (%s)，丢弃", dt,
                        )
                except (ValueError, TypeError):
                    pass

            keywords_list = parsed.get("keywords", []) if isinstance(parsed.get("keywords"), list) else []
            participants = parsed.get("participants", []) if isinstance(parsed.get("participants"), list) else []
            action_items = parsed.get("action_items", []) if isinstance(parsed.get("action_items"), list) else []
            # 确保 participants 为 [{name: ...}] 格式（与 file_upload.py 保持一致）
            if participants and isinstance(participants[0], str):
                participants = [{"name": p} for p in participants]
            comm_type = parsed.get("comm_type", "meeting")
            if comm_type not in ("meeting", "chat", "recording"):
                comm_type = "meeting"

            # conclusions 字段是 Text 类型，LLM 可能返回列表，需转为字符串
            raw_conclusions = parsed.get("conclusions")
            if isinstance(raw_conclusions, list):
                conclusions = "\n".join(str(c) for c in raw_conclusions)
            else:
                conclusions = raw_conclusions

            if existing:
                existing.title = parsed.get("title") or title
                existing.content_text = content_text
                existing.summary = parsed.get("summary")
                existing.initiator = parsed.get("initiator")
                existing.participants = participants
                existing.conclusions = conclusions
                existing.action_items = action_items
                existing.keywords = keywords_list
                existing.sentiment = parsed.get("sentiment")
                existing.duration_minutes = parsed.get("duration_minutes")
                existing.comm_time = comm_time
                existing.source_url = source_url
                existing.synced_at = datetime.utcnow()
                if asset_owner_name:
                    existing.asset_owner_name = asset_owner_name
                if embedding:
                    existing.content_vector = embedding
                await db.commit()
                await db.refresh(existing)
                logger.info("沟通资产已更新: id=%d, title=%s", existing.id, existing.title)

                # LLM 自动标签推荐（硬性规定）
                await self._auto_tag_communication(db, existing, owner_id)

                return existing, "imported"
            else:
                comm = Communication(
                    owner_id=owner_id,
                    comm_type=comm_type,
                    source_platform="feishu",
                    source_app_token=f"cloud_doc_{document_id}",
                    feishu_record_id=f"cloud_{document_id}",
                    title=parsed.get("title") or title,
                    comm_time=comm_time,
                    initiator=parsed.get("initiator"),
                    participants=participants,
                    duration_minutes=parsed.get("duration_minutes"),
                    conclusions=conclusions,
                    action_items=action_items,
                    content_text=content_text,
                    summary=parsed.get("summary"),
                    source_url=source_url,
                    asset_owner_name=asset_owner_name,
                    keywords=keywords_list,
                    sentiment=parsed.get("sentiment"),
                    feishu_created_at=feishu_created,
                    feishu_updated_at=feishu_updated,
                    synced_at=datetime.utcnow(),
                )
                if embedding:
                    comm.content_vector = embedding
                db.add(comm)
                await db.commit()
                await db.refresh(comm)
                logger.info("沟通资产已导入: id=%d, title=%s", comm.id, comm.title)

                # LLM 自动标签推荐（硬性规定）
                await self._auto_tag_communication(db, comm, owner_id)

                return comm, "imported"

        except Exception as e:
            logger.error("导入云文档为沟通资产失败 [%s]: %s", document_id, e, exc_info=True)
            try:
                await db.rollback()
            except Exception:
                pass
            return None, "failed"

    async def import_file_as_communication(
        self,
        file_token: str,
        file_name: str,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
        asset_owner_name: str | None = None,
        force: bool = False,
        feishu_owner_id: str | None = None,
    ) -> tuple[Communication | None, str]:
        """导入飞书文件（PDF 等）为沟通资产：下载文件 → 提取文本 → LLM 解析。

        Returns:
            (Communication, status) — status: "imported" | "skipped" | "failed"
        """
        try:
            # 1. 检查是否已导入
            existing = await self._find_existing_communication(db, file_token, owner_id)
            if existing and not force:
                logger.info("文件已导入为沟通资产，跳过: %s", file_token)
                return existing, "skipped"

            # 2. 获取扩展名
            ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
            if ext == file_name.lower() or not ext:
                ext = ""

            # 3. 下载文件
            content_bytes = await feishu_client.download_drive_file(
                file_token, user_access_token=user_access_token,
            )
            logger.info("文件已下载: %s (%d bytes)", file_name, len(content_bytes))

            # 4. 提取文本
            if not ext:
                ext = self._guess_extension(content_bytes) or "bin"

            is_image = ext in IMAGE_EXTENSIONS
            if is_image:
                _, content_text = await self._parse_image(content_bytes, ext, file_name)
            elif ext in EXTRACTABLE_FILE_EXTENSIONS:
                content_text = self._extract_text(content_bytes, ext)
                # PDF 特殊处理：pypdf 提取为空说明是扫描件，用视觉模型 OCR
                if ext == "pdf" and not content_text.strip():
                    content_text = await self._ocr_pdf_fallback(content_bytes, file_name)
            else:
                content_text = content_bytes.decode("utf-8", errors="replace")[:10000]

            if not content_text.strip():
                content_text = f"[{ext} 文件] {file_name}"

            title = file_name

            # 5. LLM 提取沟通资产字段
            parsed = await self._llm_parse_communication(content_text)

            # 6. 生成 Embedding
            embedding = await self._generate_embedding(title, content_text)

            # 7. 构建文档 URL
            domain = settings.feishu_base_domain or "feishu.cn"
            source_url = f"https://{domain}/file/{file_token}"

            # 8. 解析字段
            comm_time = None
            if parsed.get("comm_time"):
                try:
                    dt = datetime.fromisoformat(parsed["comm_time"])
                    if dt.tzinfo is not None:
                        dt = dt.replace(tzinfo=None)
                    comm_time = dt
                except (ValueError, TypeError):
                    pass

            keywords_list = parsed.get("keywords", []) if isinstance(parsed.get("keywords"), list) else []
            participants = parsed.get("participants", []) if isinstance(parsed.get("participants"), list) else []
            action_items = parsed.get("action_items", []) if isinstance(parsed.get("action_items"), list) else []
            # 确保 participants 为 [{name: ...}] 格式（与 file_upload.py 保持一致）
            if participants and isinstance(participants[0], str):
                participants = [{"name": p} for p in participants]
            comm_type = parsed.get("comm_type", "meeting")
            if comm_type not in ("meeting", "chat", "recording"):
                comm_type = "meeting"

            # conclusions 字段是 Text 类型，LLM 可能返回列表，需转为字符串
            raw_conclusions = parsed.get("conclusions")
            if isinstance(raw_conclusions, list):
                conclusions = "\n".join(str(c) for c in raw_conclusions)
            else:
                conclusions = raw_conclusions

            if existing:
                existing.title = parsed.get("title") or title
                existing.content_text = content_text
                existing.summary = parsed.get("summary")
                existing.initiator = parsed.get("initiator")
                existing.participants = participants
                existing.conclusions = conclusions
                existing.action_items = action_items
                existing.keywords = keywords_list
                existing.sentiment = parsed.get("sentiment")
                existing.duration_minutes = parsed.get("duration_minutes")
                existing.comm_time = comm_time
                existing.source_url = source_url
                existing.synced_at = datetime.utcnow()
                if embedding:
                    existing.content_vector = embedding
                await db.commit()
                await db.refresh(existing)
                logger.info("文件沟通资产已更新: id=%d, title=%s", existing.id, existing.title)

                # LLM 自动标签推荐（硬性规定）
                await self._auto_tag_communication(db, existing, owner_id)

                return existing, "imported"
            else:
                comm = Communication(
                    owner_id=owner_id,
                    comm_type=comm_type,
                    source_platform="feishu",
                    source_app_token=f"cloud_file_{file_token}",
                    feishu_record_id=f"cloud_{file_token}",
                    title=parsed.get("title") or title,
                    comm_time=comm_time,
                    initiator=parsed.get("initiator"),
                    participants=participants,
                    duration_minutes=parsed.get("duration_minutes"),
                    conclusions=conclusions,
                    action_items=action_items,
                    content_text=content_text,
                    summary=parsed.get("summary"),
                    source_url=source_url,
                    asset_owner_name=asset_owner_name,
                    keywords=keywords_list,
                    sentiment=parsed.get("sentiment"),
                    synced_at=datetime.utcnow(),
                )
                if embedding:
                    comm.content_vector = embedding
                db.add(comm)
                await db.commit()
                await db.refresh(comm)
                logger.info("文件沟通资产已导入: id=%d, title=%s", comm.id, comm.title)

                # LLM 自动标签推荐（硬性规定）
                await self._auto_tag_communication(db, comm, owner_id)

                return comm, "imported"

        except Exception as e:
            logger.error("导入文件为沟通资产失败 [%s]: %s", file_token, e, exc_info=True)
            try:
                await db.rollback()
            except Exception:
                pass
            return None, "failed"

    async def batch_import_as_communication(
        self,
        file_infos: list[dict],
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
    ) -> ImportResult:
        """批量导入云文档为沟通资产。

        支持 docx/doc/wiki 类型，wiki 节点会自动解析为实际文档再导入。
        每个文件有 90 秒的单独超时，避免单个文件卡住拖慢整个批次。
        """
        PER_FILE_TIMEOUT = 90  # 单文件超时 90 秒

        # wiki 类型文档需要特殊处理：先解析 obj_token 再查 owner
        await self._resolve_wiki_owners(file_infos, db, user_access_token)

        result = ImportResult()

        for info in file_infos:
            token = info.get("token", "")
            file_type = info.get("type", "docx")
            name = info.get("name", "未命名")
            feishu_owner_id = info.get("owner_id", "") or None
            # 资产所有人显示名：使用文档原始所有者
            display_owner = info.get("owner_name", "") or None
            if not token:
                result.failed += 1
                result.errors.append({"name": name, "reason": "文件token为空"})
                continue

            # 根据文件类型路由到正确的 document_id
            document_id = token
            try:
                if file_type == "wiki":
                    # wiki 节点需要先解析出实际的文档 token
                    node = await feishu_client.get_wiki_node_info(
                        token, user_access_token=user_access_token,
                    )
                    obj_type = node.get("obj_type", "")
                    if obj_type in ("docx", "doc"):
                        document_id = node.get("obj_token", token)
                    else:
                        logger.warning(
                            "wiki 节点实际类型不支持导入为沟通资产: %s (%s → %s)",
                            name, token, obj_type,
                        )
                        result.failed += 1
                        result.errors.append({"name": name, "reason": f"wiki节点类型{obj_type}不支持"})
                        continue
                elif file_type == "file":
                    # 普通文件（PDF 等）走下载 → 提取文本路径
                    try:
                        comm, status = await asyncio.wait_for(
                            self.import_file_as_communication(
                                token, name, owner_id, db, user_access_token, display_owner,
                                feishu_owner_id=feishu_owner_id,
                            ),
                            timeout=PER_FILE_TIMEOUT,
                        )
                    except asyncio.TimeoutError:
                        logger.warning("文件导入超时（%ds）: %s (%s)", PER_FILE_TIMEOUT, name, token)
                        result.failed += 1
                        result.errors.append({"name": name, "reason": f"导入超时({PER_FILE_TIMEOUT}s)"})
                        continue

                    if status == "imported":
                        result.imported += 1
                    elif status == "skipped":
                        result.skipped += 1
                    else:
                        result.failed += 1
                        result.errors.append({"name": name, "reason": "文件导入失败"})
                    await asyncio.sleep(0.5)
                    continue
            except Exception as e:
                logger.warning("解析文件类型失败 [%s]: %s", token, e)
                result.failed += 1
                result.errors.append({"name": name, "reason": str(e)[:200]})
                continue

            try:
                comm, status = await asyncio.wait_for(
                    self.import_cloud_doc_as_communication(
                        document_id, owner_id, db, user_access_token, display_owner,
                        feishu_owner_id=feishu_owner_id,
                    ),
                    timeout=PER_FILE_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning("单文件导入超时（%ds）: %s (%s)", PER_FILE_TIMEOUT, name, token)
                result.failed += 1
                result.errors.append({"name": name, "reason": f"导入超时({PER_FILE_TIMEOUT}s)"})
                continue

            if status == "imported":
                result.imported += 1
            elif status == "skipped":
                result.skipped += 1
            else:
                result.failed += 1
                result.errors.append({"name": name, "reason": "云文档导入失败"})

            await asyncio.sleep(0.5)

        return result

    async def sync_folder(
        self,
        folder_token: str,
        owner_id: str,
        db: AsyncSession,
        user_access_token: str,
    ) -> ImportResult:
        """同步飞书文件夹下所有文档/文件。"""
        # 1. 获取文件夹下的文件列表
        files = await feishu_client.list_folder_files(
            folder_token, user_access_token=user_access_token,
        )
        logger.info("文件夹 %s 中发现 %d 个支持的文件", folder_token, len(files))

        # 2. wiki 类型文档先解析 obj_token 再查 owner
        await self._resolve_wiki_owners(files, db, user_access_token)

        # 3. 补充非 wiki 文档的 owner_id / owner_name
        need_meta = [
            f for f in files
            if f.get("type") != "wiki"
            and (not f.get("owner_id") or not f.get("owner_name"))
        ]
        if need_meta:
            try:
                meta_map = await feishu_client.batch_get_doc_meta(
                    [{"token": f["token"], "type": f.get("type", "docx")} for f in need_meta],
                    user_access_token,
                )
                for f in need_meta:
                    meta = meta_map.get(f["token"])
                    if meta:
                        if not f.get("owner_id") and meta.get("owner_id"):
                            f["owner_id"] = meta["owner_id"]
                        if not f.get("owner_name") and meta.get("owner_name"):
                            f["owner_name"] = meta["owner_name"]
            except Exception as e:
                logger.warning("batch_get_doc_meta 补充 owner 信息失败: %s", e)

        # 4. 逐个导入
        return await self.batch_import(
            files, owner_id, db, user_access_token,
            source_platform="feishu_folder",
        )

    # ── 内部辅助方法 ───────────────────────────────────────

    @staticmethod
    async def _apply_tags(doc_id: int, tag_ids: list[int], db: AsyncSession) -> None:
        """给文档打上指定标签（幂等，重复打不会报错）。"""
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from app.models.tag import ContentTag

        for tag_id in tag_ids:
            try:
                stmt = pg_insert(ContentTag).values(
                    tag_id=tag_id,
                    content_type="document",
                    content_id=doc_id,
                    tagged_by="source_inherit",
                    confidence=1.0,
                ).on_conflict_do_nothing(
                    index_elements=["tag_id", "content_type", "content_id"]
                )
                await db.execute(stmt)
            except Exception as e:
                logger.warning("给文档 %d 打标签 %d 失败: %s", doc_id, tag_id, e)
        await db.commit()

    @staticmethod
    async def _auto_tag_communication(
        db: AsyncSession, comm, owner_id: str,
    ) -> None:
        """为沟通资产执行 LLM 自动标签推荐（硬性规定：必须至少一个标签）。"""
        try:
            from app.services.llm import auto_tag_content, _force_apply_other_tag
            content = comm.summary or (comm.content_text or "")[:2000]
            tagged = await auto_tag_content(db, comm.id, "communication", content, owner_id)
            if tagged:
                await db.commit()
                logger.info("沟通资产自动标签: comm_id=%d, 新增 %d 个标签", comm.id, tagged)
            else:
                # 硬性保底
                from sqlalchemy import text as sql_text
                check = await db.execute(
                    sql_text("SELECT COUNT(*) FROM content_tags WHERE content_type = 'communication' AND content_id = :cid"),
                    {"cid": comm.id},
                )
                if (check.scalar() or 0) == 0:
                    await _force_apply_other_tag(db, comm.id, "communication", owner_id)
                    await db.commit()
                    logger.warning("沟通资产硬性保底: comm_id=%d 无标签, 已强制打上「其他」", comm.id)
        except Exception as e:
            logger.warning("沟通资产自动标签失败 (comm_id=%d): %s", comm.id, e)

    @staticmethod
    async def _find_existing_communication(db: AsyncSession, document_id: str, owner_id: str) -> Communication | None:
        """查找已导入为沟通资产的云文档。"""
        stmt = select(Communication).where(
            Communication.feishu_record_id == f"cloud_{document_id}",
            Communication.owner_id == owner_id,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def _llm_parse_communication(content_text: str) -> dict:
        """调用 LLM 解析沟通资产字段。"""
        default = {
            "title": None, "comm_type": "meeting", "initiator": None,
            "participants": [], "summary": None, "conclusions": None,
            "action_items": [], "keywords": [], "sentiment": "neutral",
            "duration_minutes": None, "comm_time": None,
        }
        if not settings.llm_api_key or settings.llm_api_key.startswith("sk-xxx"):
            return default
        try:
            from app.services.llm import llm_client
            return await llm_client.parse_communication_doc(content_text)
        except Exception as e:
            logger.warning("LLM 沟通资产解析失败: %s", e)
            return default

    @staticmethod
    async def _fetch_doc_content(document_id: str, user_access_token: str) -> dict:
        """调用飞书 Block API 获取云文档内容（title + content_text + created/modified_time）。"""
        return await feishu_client.get_document_content(
            document_id, user_access_token=user_access_token,
        )

    @staticmethod
    async def _find_existing(db: AsyncSession, feishu_record_id: str, owner_id: str) -> Document | None:
        """查找已导入的文档记录。"""
        stmt = select(Document).where(
            Document.feishu_record_id == feishu_record_id,
            Document.owner_id == owner_id,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def _llm_parse(content_text: str, file_type: str) -> dict:
        """调用 LLM 结构化解析文本内容。"""
        default = {"title": None, "summary": None, "author": None, "tags": [], "category": None}
        if not settings.llm_api_key or settings.llm_api_key.startswith("sk-xxx"):
            return default
        try:
            from app.services.llm import llm_client
            return await llm_client.parse_uploaded_file(content_text, file_type)
        except Exception as e:
            logger.warning("LLM 解析失败: %s", e)
            return default

    @staticmethod
    async def _generate_embedding(title: str, content_text: str) -> list[float] | None:
        """生成文本向量。"""
        if not settings.embedding_api_key or settings.embedding_api_key.startswith("sk-xxx"):
            return None
        try:
            from app.services.llm import llm_client
            embed_text = f"{title} {content_text}".strip()
            return await llm_client.generate_embedding(embed_text[:2000])
        except Exception as e:
            logger.warning("Embedding 生成失败: %s", e)
            return None

    @staticmethod
    async def _parse_image(content_bytes: bytes, ext: str, file_name: str) -> tuple[dict, str]:
        """解析图片文件。"""
        parsed = {"title": file_name, "summary": None, "author": None, "tags": [], "category": None}
        content_text = f"[图片文件: {ext}] {file_name}"

        if settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                parsed = await llm_client.parse_image_file(content_bytes, ext)
                content_text = parsed.get("content_text") or content_text
            except Exception as e:
                logger.warning("图片解析失败: %s", e)

        return parsed, content_text

    @staticmethod
    async def _ocr_pdf_fallback(content_bytes: bytes, file_name: str) -> str:
        """纯图片 PDF 的 OCR 回退：调用视觉模型逐页识别文字。"""
        try:
            from app.services.llm import llm_client
            logger.info("检测到纯图片 PDF，启动视觉模型 OCR: %s", file_name)
            return await llm_client.ocr_pdf_pages(content_bytes)
        except Exception as e:
            logger.warning("PDF OCR 失败: %s", e)
            return ""

    @staticmethod
    def _extract_text(content_bytes: bytes, ext: str) -> str:
        """从文件二进制内容提取纯文本（复用 FileUploadService 的逻辑）。"""
        from app.services.file_upload import FileUploadService
        return FileUploadService._extract_text(content_bytes, ext)

    @staticmethod
    def _guess_extension(content_bytes: bytes) -> str | None:
        """根据文件头部魔数猜测文件扩展名。"""
        if len(content_bytes) < 8:
            return None
        header = content_bytes[:8]
        if header[:4] == b"%PDF":
            return "pdf"
        if header[:4] == b"PK\x03\x04":
            # ZIP 格式：可能是 docx/pptx/xlsx
            if b"word/" in content_bytes[:2000]:
                return "docx"
            if b"ppt/" in content_bytes[:2000]:
                return "pptx"
            if b"xl/" in content_bytes[:2000]:
                return "xlsx"
            return "docx"  # 默认当 docx 处理
        if header[:2] == b"\xff\xd8":
            return "jpg"
        if header[:4] == b"\x89PNG":
            return "png"
        return None


# 模块级单例
cloud_doc_import_service = CloudDocImportService()
