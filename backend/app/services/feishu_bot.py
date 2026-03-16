"""飞书机器人消息处理服务 — 收到消息 → LLM智能路由 → 自动入库 → 结果卡片(可调整)。"""

import asyncio
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime
from urllib.parse import urlparse

import httpx

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.bot_message_task import BotMessageTask
from app.models.document import Document
from app.models.communication import Communication
from app.models.extraction_rule import ExtractionRule
from app.models.cleaning_rule import CleaningRule
from app.models.user import User
from app.services.feishu import feishu_client

logger = logging.getLogger(__name__)

# ── 链接正则 ──────────────────────────────────────────────
# 匹配所有飞书链接，提取路径类型和 token
# 例: feishu.cn/docx/ABC  feishu.cn/wiki/ABC  feishu.cn/base/ABC?table=XYZ  feishu.cn/sheets/ABC  feishu.cn/file/ABC
RE_FEISHU_LINK = re.compile(
    r"https?://[\w.]*feishu\.cn/(docx|docs|wiki|base|bitable|sheets|file|slides|mindnotes|drive)/([\w]+)(?:\?table=([\w]+))?",
    re.IGNORECASE,
)
# 通用 URL 匹配
RE_URL = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)

# 资产类型的中文标签
ASSET_TYPE_LABELS = {
    "document": "文档文字",
    "comm_recording": "会议录音",
    "structured": "表格",
}

# 资产类型对应的前端页面
ASSET_PAGE_MAP = {
    "document": "/documents",
    "comm_recording": "/communications",
    "structured": "/structured-tables",
}


class FeishuBotService:
    """飞书机器人消息处理核心服务。"""

    # ── 消息解析 ──────────────────────────────────────────────

    def parse_message(self, message: dict) -> dict:
        """解析飞书消息，识别输入类型和内容。"""
        msg_type = message.get("message_type", "")
        content_str = message.get("content", "{}")
        try:
            content = json.loads(content_str) if isinstance(content_str, str) else content_str
        except json.JSONDecodeError:
            content = {}

        # 文件消息
        if msg_type == "file":
            file_key = content.get("file_key", "")
            file_name = content.get("file_name", "未命名文件")
            return {
                "input_type": "file",
                "file_key": file_key,
                "file_name": file_name,
                "preview": f"文件: {file_name}",
            }

        # 图片消息
        if msg_type == "image":
            image_key = content.get("image_key", "")
            return {
                "input_type": "file",
                "file_key": image_key,
                "file_name": "image.png",
                "is_image": True,
                "preview": "图片消息",
            }

        # 文本或富文本 — 检查是否包含飞书链接
        text = ""
        if msg_type == "text":
            text = content.get("text", "")
        elif msg_type == "post":
            post = content.get("zh_cn") or content.get("en_us") or {}
            title = post.get("title", "")
            parts = []
            for para in post.get("content", []):
                for elem in para:
                    if elem.get("tag") == "text":
                        parts.append(elem.get("text", ""))
                    elif elem.get("tag") == "a":
                        parts.append(elem.get("href", ""))
            text = (title + "\n" + " ".join(parts)).strip()

        # 匹配飞书链接（统一处理所有类型）
        m_feishu = RE_FEISHU_LINK.search(text)
        if m_feishu:
            link_type = m_feishu.group(1).lower()  # docx, wiki, base, sheets, file...
            token = m_feishu.group(2)
            table_id = m_feishu.group(3) or ""

            # 多维表格
            if link_type in ("base", "bitable"):
                return {
                    "input_type": "bitable",
                    "app_token": token,
                    "table_id": table_id,
                    "text": text,
                    "preview": f"多维表格: {token}",
                }

            # 电子表格
            if link_type == "sheets":
                return {
                    "input_type": "cloud_doc",
                    "doc_token": token,
                    "feishu_doc_type": "sheet",
                    "text": text,
                    "preview": f"飞书电子表格: {token}",
                }

            # 知识库 — 可能是文档也可能是多维表格，入库时动态判断
            if link_type == "wiki":
                return {
                    "input_type": "cloud_doc",
                    "doc_token": token,
                    "feishu_doc_type": "wiki",
                    "text": text,
                    "preview": f"知识库文档: {token}",
                }

            # 云文档 / 幻灯片 / 思维导图 / 文件 / 云空间
            type_label_map = {
                "docx": "云文档", "docs": "云文档",
                "slides": "幻灯片", "mindnotes": "思维导图",
                "file": "飞书文件", "drive": "云空间文件",
            }
            return {
                "input_type": "cloud_doc",
                "doc_token": token,
                "feishu_doc_type": link_type,
                "text": text,
                "preview": f"{type_label_map.get(link_type, '飞书文档')}: {token}",
            }

        # 匹配外网链接（非飞书链接）
        m_url = RE_URL.search(text)
        if m_url:
            url = m_url.group(0).rstrip(".,;:!?）)")
            parsed_url = urlparse(url)
            # 排除飞书域名（已由上面的正则处理）
            if parsed_url.hostname and "feishu.cn" not in parsed_url.hostname:
                return {
                    "input_type": "web_url",
                    "url": url,
                    "text": text,
                    "preview": f"网页链接: {url[:80]}",
                }

        # 纯文字
        preview = text[:100] + ("..." if len(text) > 100 else "") if text else "(空消息)"
        return {"input_type": "text", "text": text, "preview": preview}

    # ── 处理消息事件（新流程入口）──────────────────────────────

    async def handle_message(self, event: dict) -> None:
        """收到消息 → 创建任务 → 异步执行(LLM路由+入库+发卡片)。"""
        sender = event.get("sender", {})
        open_id = sender.get("sender_id", {}).get("open_id", "")
        message = event.get("message", {})
        message_id = message.get("message_id", "")

        if not open_id or not message_id:
            logger.warning("消息事件缺少 open_id 或 message_id，跳过")
            return

        parsed = self.parse_message(message)
        parsed["message_id"] = message_id
        task_id = str(uuid.uuid4())

        async with async_session() as db:
            user = await self._find_user(db, open_id)
            if not user:
                await self._reply_text(
                    open_id,
                    f"你还未登录流光数据中台，请先用飞书账号登录平台。\n👉 前往登录：{settings.platform_url}/login",
                )
                return

            task = BotMessageTask(
                task_id=task_id,
                open_id=open_id,
                message_id=message_id,
                input_type=parsed["input_type"],
                raw_content=parsed,
                status="processing",
            )
            db.add(task)
            try:
                await db.commit()
            except Exception:
                logger.info("消息已处理过，跳过: %s", message_id)
                return

        # 先告知用户正在处理
        await self._reply_text(open_id, "收到！正在智能分析内容并自动入库，请稍候...")

        # 异步执行：LLM 路由 → 入库 → 发结果卡片
        asyncio.create_task(self._auto_ingest_and_report(task_id, open_id))

    # ── 自动入库 + 发结果卡片 ──────────────────────────────────

    async def _auto_ingest_and_report(self, task_id: str, open_id: str) -> None:
        """LLM 智能路由 → 自动入库 → 发送结果卡片（含调整选项）。"""
        try:
            async with async_session() as db:
                task = await self._get_task(db, task_id)
                if not task:
                    return

                user = await self._find_user(db, open_id)
                if not user:
                    task.status = "failed"
                    task.result_message = "找不到用户"
                    await db.commit()
                    return

                owner_id = user.feishu_open_id
                raw = task.raw_content
                input_type = task.input_type

                # ── Step 1: 查询用户的规则列表 ──
                extraction_rules = (await db.execute(
                    select(ExtractionRule).where(
                        ExtractionRule.owner_id == owner_id,
                        ExtractionRule.is_active.is_(True),
                    )
                )).scalars().all()

                cleaning_rules = (await db.execute(
                    select(CleaningRule).where(
                        CleaningRule.owner_id == owner_id,
                        CleaningRule.is_active.is_(True),
                    )
                )).scalars().all()

                # ── Step 2: 智能路由（含规则推荐）──
                route = await self._smart_route(raw, input_type, extraction_rules, cleaning_rules)
                asset_type = route["asset_type"]
                llm_reason = route["reason"]
                rec_ext_id = route.get("extraction_rule_id", 0)
                rec_ext_reason = route.get("extraction_reason", "未使用")
                rec_cln_id = route.get("cleaning_rule_id", 0)
                rec_cln_reason = route.get("cleaning_reason", "未使用")

                task.selected_asset_type = asset_type
                task.selected_extraction_rule_id = rec_ext_id if rec_ext_id else None
                task.selected_cleaning_rule_id = rec_cln_id if rec_cln_id else None
                task.llm_reason = llm_reason
                await db.commit()

                # ── Step 3: 获取 user_access_token（飞书链接需要）──
                user_token = None
                if input_type in ("cloud_doc", "bitable"):
                    user_token = await self._get_user_access_token(user, db)
                    if not user_token:
                        task.status = "failed"
                        task.result_message = self._LOGIN_GUIDE
                        await db.commit()
                        await self._reply_text(open_id, self._LOGIN_GUIDE)
                        return

                # ── Step 3.5: 查询飞书文档真实所有者名字（用于 asset_owner_name）──
                asset_owner = user.name  # 默认：发消息的人自己
                if input_type in ("cloud_doc", "bitable") and user_token:
                    _, asset_owner = await self._resolve_doc_owner(
                        raw, input_type, user_token, db, owner_id, user.name,
                    )

                # ── Step 4: 执行入库 ──
                # owner_id = 发消息的人（用于RLS权限），asset_owner_name = 飞书资产所有人
                result_msg, record_id, record_type = await self._do_ingest(
                    raw, input_type, asset_type, owner_id, db, asset_owner,
                    user_access_token=user_token,
                )

                task.ingested_record_id = record_id
                task.ingested_record_type = record_type
                task.status = "done"
                task.result_message = result_msg
                await db.commit()

                # ── Step 4.5a: 应用 LLM 推荐的提取规则 ──
                logger.info(
                    "首次入库规则检查: rec_ext_id=%s, record_id=%s, record_type=%s",
                    rec_ext_id, record_id, record_type,
                )
                if rec_ext_id and record_id and record_type in ("document", "communication"):
                    try:
                        from app.services.etl.enricher import extract_key_info
                        content_text = await self._get_full_content(db, record_id, record_type)
                        logger.info("首次入库提取规则: content_text长度=%d", len(content_text) if content_text else 0)
                        if content_text:
                            key_info = await extract_key_info(
                                content_text, rec_ext_id, db,
                                title=result_msg,
                            )
                            logger.info("首次入库提取规则: extract_key_info 返回=%s", "有结果" if key_info else "None")
                            if key_info is not None:
                                from sqlalchemy import text as sql_text
                                table_name = "documents" if record_type == "document" else "communications"
                                await db.execute(
                                    sql_text(
                                        f"UPDATE {table_name} SET extraction_rule_id = :rule_id, "
                                        f"key_info = CAST(:key_info AS jsonb) WHERE id = :id"
                                    ),
                                    {
                                        "rule_id": rec_ext_id,
                                        "key_info": json.dumps(key_info, ensure_ascii=False),
                                        "id": record_id,
                                    },
                                )
                                await db.commit()
                                logger.info("首次入库已应用提取规则 id=%d, record=%s/%d", rec_ext_id, record_type, record_id)
                            else:
                                logger.warning("首次入库提取规则返回 None (rule_id=%d)", rec_ext_id)
                        else:
                            logger.warning("首次入库提取规则跳过: 记录 %s/%s 内容为空", record_type, record_id)
                    except Exception as e:
                        logger.error("首次入库应用提取规则失败 (rule_id=%d): %s", rec_ext_id, e, exc_info=True)

                # ── Step 4.5b: 应用 LLM 推荐的清洗规则 ──
                if rec_cln_id and record_id and record_type == "structured_table":
                    try:
                        cln_rule_result = await db.execute(
                            select(CleaningRule).where(CleaningRule.id == rec_cln_id)
                        )
                        cln_rule_obj = cln_rule_result.scalar_one_or_none()
                        if cln_rule_obj:
                            from app.services.structured_table_cleaner import apply_cleaning_rule
                            cln_stats = await apply_cleaning_rule(db, record_id, cln_rule_obj)
                            if cln_stats and "error" not in cln_stats:
                                logger.info(
                                    "首次入库已应用清洗规则 id=%d, table=%d: rows %d→%d, fields %d→%d",
                                    rec_cln_id, record_id,
                                    cln_stats.get("rows_before", 0), cln_stats.get("rows_after", 0),
                                    cln_stats.get("fields_before", 0), cln_stats.get("fields_after", 0),
                                )
                    except Exception as e:
                        logger.warning("首次入库应用清洗规则失败 (rule_id=%d): %s", rec_cln_id, e)

                # ── Step 4.5c: 自动打标签（硬性规定：必须至少一个标签）──
                if record_id and record_type:
                    try:
                        from app.services.llm import auto_tag_content, _force_apply_other_tag
                        # 从数据库读取实际内容（raw 中可能无完整文本）
                        content_text = await self._get_record_content(db, record_id, record_type)
                        if not content_text:
                            content_text = raw.get("text", "") or raw.get("preview", "")
                        tagged = await auto_tag_content(db, record_id, record_type, content_text[:2000], owner_id)
                        if tagged:
                            await db.commit()
                        else:
                            # 硬性保底
                            from sqlalchemy import text as sql_text
                            check = await db.execute(
                                sql_text("SELECT COUNT(*) FROM content_tags WHERE content_type = :ct AND content_id = :cid"),
                                {"ct": record_type, "cid": record_id},
                            )
                            if (check.scalar() or 0) == 0:
                                await _force_apply_other_tag(db, record_id, record_type, owner_id)
                                await db.commit()
                                logger.warning("机器人入库硬性保底: %s id=%d 无标签, 已强制打上「其他」", record_type, record_id)
                    except Exception as e:
                        logger.warning("自动打标签失败: %s", e)

            # ── Step 5: 发送结果卡片 ──
            # 根据实际入库结果修正显示的 asset_type 和 input_type
            actual_asset = asset_type
            actual_input_type = input_type
            if record_type == "structured_table":
                actual_asset = "structured"
                actual_input_type = "bitable"
                llm_reason = "多维表格链接自动入库为表格"
            elif record_type == "document":
                actual_asset = "document"
            elif record_type == "communication":
                actual_asset = task.selected_asset_type or asset_type

            # 查找推荐规则的名称
            rec_ext_name = "未使用"
            for r in extraction_rules:
                if r.id == rec_ext_id:
                    rec_ext_name = r.name
                    break
            rec_cln_name = "未使用"
            for r in cleaning_rules:
                if r.id == rec_cln_id:
                    rec_cln_name = r.name
                    break

            card = self._build_result_card(
                task_id=task_id,
                input_type=actual_input_type,
                preview=raw.get("preview", ""),
                asset_type=actual_asset,
                llm_reason=llm_reason,
                result_msg=result_msg,
                extraction_rules=extraction_rules,
                cleaning_rules=cleaning_rules,
                rec_ext_id=rec_ext_id,
                rec_ext_name=rec_ext_name,
                rec_ext_reason=rec_ext_reason,
                rec_cln_id=rec_cln_id,
                rec_cln_name=rec_cln_name,
                rec_cln_reason=rec_cln_reason,
            )
            await self._send_card(open_id, card)

        except Exception as e:
            logger.error("自动入库失败 [%s]: %s", task_id, e, exc_info=True)
            try:
                async with async_session() as db:
                    task = await self._get_task(db, task_id)
                    if task:
                        task.status = "failed"
                        task.result_message = str(e)[:500]
                        await db.commit()
                await self._reply_text(open_id, f"入库失败：{str(e)[:200]}")
            except Exception:
                logger.error("更新失败状态也失败了", exc_info=True)

    # ── 智能路由 ──────────────────────────────────────────────

    async def _smart_route(
        self, raw: dict, input_type: str,
        extraction_rules: list, cleaning_rules: list,
    ) -> dict:
        """根据内容类型和内容预览，智能判断入哪张表 + 推荐规则。

        Returns: {
            "asset_type": str, "reason": str,
            "extraction_rule_id": int, "extraction_reason": str,
            "cleaning_rule_id": int, "cleaning_reason": str,
        }
        """
        default = {
            "asset_type": "document", "reason": "默认入库为文档",
            "extraction_rule_id": 0, "extraction_reason": "未使用提取规则",
            "cleaning_rule_id": 0, "cleaning_reason": "未使用清洗规则",
        }

        # 确定性路由：某些类型不需要 LLM 判断资产类型
        fixed_asset = None
        if input_type == "web_url":
            fixed_asset = ("document", "网页内容自动入库为文档")
        elif input_type == "bitable":
            fixed_asset = ("structured", "多维表格链接自动入库为结构化表格")
        elif input_type == "cloud_doc":
            # 标题含会议纪要相关关键词时，默认入库为会议录音
            doc_hint = raw.get("text", "") + " " + raw.get("preview", "")
            _meeting_kws = ("文字记录", "智能纪要", "会议纪要", "会议记录", "会议录音")
            if any(kw in doc_hint for kw in _meeting_kws):
                fixed_asset = ("comm_recording", "文档标题含会议纪要关键词，自动入库为会议录音")
            else:
                fixed_asset = ("document", "云文档链接自动入库为文档文字")
        else:
            file_name = raw.get("file_name", "")
            file_ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
            if input_type == "file":
                if file_ext in {"mp3", "wav", "m4a", "ogg", "flac", "aac", "wma", "opus"}:
                    fixed_asset = ("comm_recording", "音频文件自动入库为录音记录")
                elif file_ext in {"xlsx", "xls", "csv", "tsv"}:
                    fixed_asset = ("structured", "表格文件自动入库为结构化表格")
                elif raw.get("is_image"):
                    fixed_asset = ("document", "图片默认入库为文档")

        # 对于确定性类型且没有可用规则的场景，直接返回
        if fixed_asset and not extraction_rules and not cleaning_rules:
            return {**default, "asset_type": fixed_asset[0], "reason": fixed_asset[1]}

        # LLM 智能判断（同时推荐规则）
        preview = raw.get("preview", "") or raw.get("text", "")[:200]
        file_name = raw.get("file_name", "")

        if settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                # 构建规则列表给 LLM
                ext_rules_data = [
                    {"id": r.id, "name": r.name, "description": getattr(r, "description", "")}
                    for r in extraction_rules
                ] if extraction_rules else None
                cln_rules_data = [
                    {"id": r.id, "name": r.name, "description": getattr(r, "description", "")}
                    for r in cleaning_rules
                ] if cleaning_rules else None

                result = await llm_client.classify_content(
                    content_preview=preview,
                    file_name=file_name,
                    input_type=input_type,
                    extraction_rules=ext_rules_data,
                    cleaning_rules=cln_rules_data,
                )

                # 如果资产类型是确定性的，覆盖 LLM 的判断
                if fixed_asset:
                    result["asset_type"] = fixed_asset[0]
                    result["reason"] = fixed_asset[1]

                return {**default, **result}
            except Exception as e:
                logger.warning("LLM 智能路由失败，使用默认: %s", e)

        if fixed_asset:
            return {**default, "asset_type": fixed_asset[0], "reason": fixed_asset[1]}
        return default

    # ── 执行入库 ──────────────────────────────────────────────

    async def _do_ingest(
        self, raw: dict, input_type: str, asset_type: str,
        owner_id: str, db: AsyncSession, asset_owner_name: str | None,
        user_access_token: str | None = None,
        force: bool = False,
    ) -> tuple[str, int | None, str | None]:
        """执行实际入库操作。

        Args:
            force: 为 True 时强制重新导入（重新入库场景），不跳过已存在的记录。

        Returns: (result_msg, record_id, record_type)
        """
        if input_type == "text":
            return await self._ingest_text(
                raw.get("text", ""), owner_id, db, asset_type, asset_owner_name
            )
        elif input_type == "file":
            return await self._ingest_file(
                raw.get("file_key", ""),
                raw.get("file_name", "未命名文件"),
                owner_id, db, asset_type, asset_owner_name,
                is_image=raw.get("is_image", False),
                message_id=raw.get("message_id", ""),
            )
        elif input_type == "cloud_doc":
            return await self._ingest_cloud_doc(
                raw.get("doc_token", ""), owner_id, db, asset_owner_name,
                user_access_token=user_access_token,
                feishu_doc_type=raw.get("feishu_doc_type", "docx"),
                asset_type=asset_type,
                force=force,
            )
        elif input_type == "bitable":
            return await self._ingest_bitable(
                raw.get("app_token", ""),
                raw.get("table_id", ""),
                owner_id, db, asset_owner_name,
                user_access_token=user_access_token,
            )
        elif input_type == "web_url":
            return await self._ingest_web_url(
                raw.get("url", ""), owner_id, db, asset_owner_name,
            )
        else:
            return f"不支持的输入类型: {input_type}", None, None

    # ── 卡片回调处理 ──────────────────────────────────────────

    async def handle_card_action(self, callback: dict) -> dict | None:
        """处理卡片按钮回调（form_submit）。"""
        open_id = callback.get("open_id", "")
        action = callback.get("action", {})
        action_value = action.get("value", {})
        action_type = action_value.get("action", "")
        task_id = action_value.get("task_id", "")

        if not task_id:
            return None

        if action_type == "confirm_ok":
            return self._build_status_card("已确认", "数据已入库，感谢使用！", "green")

        if action_type == "readjust":
            return await self._handle_readjust(task_id, open_id, callback)

        return None

    async def _handle_readjust(self, task_id: str, open_id: str, callback: dict) -> dict:
        """用户调整：删除旧记录 → 按新选择重新入库。"""
        form_value = callback.get("action", {}).get("form_value", {})
        new_asset_type = form_value.get("asset_type", "document")
        new_ext_rule_id = int(form_value.get("extraction_rule_id", "0") or "0")
        new_cln_rule_id = int(form_value.get("cleaning_rule_id", "0") or "0")

        async with async_session() as db:
            task = await self._get_task(db, task_id)
            if not task:
                return self._build_status_card("任务不存在", "找不到对应任务。", "carmine")

            # 防止并发：上一次重新入库还没完成时拒绝
            if task.status == "processing":
                return self._build_status_card(
                    "请稍候", "上一次重新入库还在处理中，请等待完成后再试。", "orange",
                )

            user = await self._find_user(db, open_id)
            if not user:
                return self._build_status_card("用户未找到", "请先登录平台。", "carmine")

            # ── 删除旧记录 ──
            old_id = task.ingested_record_id
            old_type = task.ingested_record_type
            if old_id and old_type:
                await self._delete_record(db, old_id, old_type)
                logger.info("已删除旧记录: type=%s, id=%d", old_type, old_id)

            # ── 更新任务状态 ──
            task.selected_asset_type = new_asset_type
            task.selected_extraction_rule_id = new_ext_rule_id if new_ext_rule_id else None
            task.selected_cleaning_rule_id = new_cln_rule_id if new_cln_rule_id else None
            task.status = "processing"
            task.ingested_record_id = None
            task.ingested_record_type = None
            await db.commit()

        # 异步重新入库
        asyncio.create_task(self._re_ingest_and_report(
            task_id, open_id, new_asset_type,
            extraction_rule_id=new_ext_rule_id,
            cleaning_rule_id=new_cln_rule_id,
        ))

        return self._build_status_card(
            "正在重新入库",
            f"正在按「{ASSET_TYPE_LABELS.get(new_asset_type, new_asset_type)}」重新入库，请稍候...\n处理中请勿重复点击。",
            "blue",
        )

    async def _re_ingest_and_report(
        self, task_id: str, open_id: str, asset_type: str,
        extraction_rule_id: int = 0, cleaning_rule_id: int = 0,
    ) -> None:
        """重新入库并发送新的结果卡片。"""
        # 立即发送文字反馈，缓解等待焦虑
        asset_label = ASSET_TYPE_LABELS.get(asset_type, asset_type)
        await self._reply_text(
            open_id,
            f"🔄 已收到重新入库请求，正在按「{asset_label}」处理中...\n"
            f"涉及删除旧数据、LLM 解析、生成摘要等步骤，通常需要 10~30 秒，请稍候。",
        )

        try:
            async with async_session() as db:
                task = await self._get_task(db, task_id)
                if not task:
                    return

                user = await self._find_user(db, open_id)
                if not user:
                    return

                owner_id = user.feishu_open_id
                raw = task.raw_content
                input_type = task.input_type

                # 获取 user_access_token（云文档/多维表格需要）
                user_token = None
                if input_type in ("cloud_doc", "bitable"):
                    user_token = await self._get_user_access_token(user, db)

                result_msg, record_id, record_type = await self._do_ingest(
                    raw, input_type, asset_type, owner_id, db, user.name,
                    user_access_token=user_token,
                    force=True,  # 重新入库强制重新导入
                )

                task.ingested_record_id = record_id
                task.ingested_record_type = record_type
                task.status = "done"
                task.result_message = result_msg
                await db.commit()

                # 应用用户选择的提取规则
                ext_rule_applied = False
                ext_rule_name = "未使用"
                logger.info(
                    "重新入库规则检查: extraction_rule_id=%s, record_id=%s, record_type=%s",
                    extraction_rule_id, record_id, record_type,
                )
                if extraction_rule_id and record_id and record_type in ("document", "communication"):
                    try:
                        from app.services.etl.enricher import extract_key_info
                        # 提取规则需要完整内容（不用 _get_record_content，它只返回摘要/前2000字）
                        content_text = await self._get_full_content(db, record_id, record_type)
                        logger.info(
                            "重新入库提取规则: content_text长度=%d",
                            len(content_text) if content_text else 0,
                        )
                        if content_text:
                            key_info = await extract_key_info(
                                content_text, extraction_rule_id, db,
                                title=result_msg,
                            )
                            logger.info("重新入库提取规则: extract_key_info 返回=%s", "有结果" if key_info else "None")
                            if key_info is not None:
                                from sqlalchemy import text as sql_text
                                table_name = "documents" if record_type == "document" else "communications"
                                await db.execute(
                                    sql_text(
                                        f"UPDATE {table_name} SET extraction_rule_id = :rule_id, "
                                        f"key_info = CAST(:key_info AS jsonb) WHERE id = :id"
                                    ),
                                    {
                                        "rule_id": extraction_rule_id,
                                        "key_info": json.dumps(key_info, ensure_ascii=False),
                                        "id": record_id,
                                    },
                                )
                                await db.commit()
                                ext_rule_applied = True
                                logger.info("重新入库已应用提取规则 id=%d, record=%s/%d, key_info=%s",
                                            extraction_rule_id, record_type, record_id,
                                            json.dumps(key_info, ensure_ascii=False)[:200])
                            else:
                                logger.warning("重新入库提取规则返回 None (rule_id=%d), 可能规则无字段定义或 LLM 失败", extraction_rule_id)
                        else:
                            logger.warning("重新入库提取规则跳过: 记录 %s/%s 内容为空", record_type, record_id)
                    except Exception as e:
                        logger.error("重新入库应用提取规则失败 (rule_id=%d): %s", extraction_rule_id, e, exc_info=True)
                elif extraction_rule_id:
                    logger.warning(
                        "重新入库提取规则条件不满足: extraction_rule_id=%s, record_id=%s, record_type=%s",
                        extraction_rule_id, record_id, record_type,
                    )

                # 查找规则名称（用于反馈）
                if extraction_rule_id:
                    ext_rule_obj = await db.execute(
                        select(ExtractionRule).where(ExtractionRule.id == extraction_rule_id)
                    )
                    ext_rule_obj = ext_rule_obj.scalar_one_or_none()
                    if ext_rule_obj:
                        ext_rule_name = ext_rule_obj.name

                # 应用用户选择的清洗规则
                cln_rule_applied = False
                cln_rule_name = "未使用"
                cln_stats = None
                if cleaning_rule_id:
                    cln_rule_result = await db.execute(
                        select(CleaningRule).where(CleaningRule.id == cleaning_rule_id)
                    )
                    cln_rule_obj = cln_rule_result.scalar_one_or_none()
                    if cln_rule_obj:
                        cln_rule_name = cln_rule_obj.name
                        # 对结构化表格应用清洗
                        if record_id and record_type == "structured_table":
                            try:
                                from app.services.structured_table_cleaner import apply_cleaning_rule
                                cln_stats = await apply_cleaning_rule(db, record_id, cln_rule_obj)
                                if cln_stats and "error" not in cln_stats:
                                    cln_rule_applied = True
                                    logger.info(
                                        "重新入库已应用清洗规则 id=%d, table=%d: rows %d→%d, fields %d→%d",
                                        cleaning_rule_id, record_id,
                                        cln_stats.get("rows_before", 0), cln_stats.get("rows_after", 0),
                                        cln_stats.get("fields_before", 0), cln_stats.get("fields_after", 0),
                                    )
                            except Exception as e:
                                logger.warning("重新入库应用清洗规则失败 (rule_id=%d): %s", cleaning_rule_id, e)

                # 自动打标签（重新入库：先清理旧标签再重新打）
                if record_id and record_type:
                    try:
                        from sqlalchemy import text as sql_text
                        # 清理该记录的旧标签，确保重新打标签
                        await db.execute(
                            sql_text("DELETE FROM content_tags WHERE content_type = :ct AND content_id = :cid"),
                            {"ct": record_type, "cid": record_id},
                        )
                        await db.commit()

                        from app.services.llm import auto_tag_content, _force_apply_other_tag
                        content_text = await self._get_record_content(db, record_id, record_type)
                        if not content_text:
                            content_text = raw.get("text", "") or raw.get("preview", "")
                        tagged = await auto_tag_content(db, record_id, record_type, content_text[:2000], owner_id)
                        if tagged:
                            await db.commit()
                            logger.info("重新入库自动打标签成功: %s id=%d, 共 %d 个标签", record_type, record_id, tagged)
                        else:
                            # 硬性保底
                            check = await db.execute(
                                sql_text("SELECT COUNT(*) FROM content_tags WHERE content_type = :ct AND content_id = :cid"),
                                {"ct": record_type, "cid": record_id},
                            )
                            if (check.scalar() or 0) == 0:
                                await _force_apply_other_tag(db, record_id, record_type, owner_id)
                                await db.commit()
                                logger.warning("重新入库硬性保底: %s id=%d 无标签, 已强制打上「其他」", record_type, record_id)
                    except Exception as e:
                        logger.warning("重新入库自动打标签失败: %s", e)

                extraction_rules = (await db.execute(
                    select(ExtractionRule).where(
                        ExtractionRule.owner_id == owner_id,
                        ExtractionRule.is_active.is_(True),
                    )
                )).scalars().all()

                cleaning_rules = (await db.execute(
                    select(CleaningRule).where(
                        CleaningRule.owner_id == owner_id,
                        CleaningRule.is_active.is_(True),
                    )
                )).scalars().all()

            # 先发送文字反馈（包含规则使用情况）
            asset_label = ASSET_TYPE_LABELS.get(asset_type, asset_type)
            if record_id:
                feedback_parts = [f"已删除旧数据并重新入库为「{asset_label}」。\n{result_msg}"]
                if extraction_rule_id:
                    if ext_rule_applied:
                        feedback_parts.append(f"提取规则「{ext_rule_name}」已应用")
                    else:
                        feedback_parts.append(f"提取规则「{ext_rule_name}」未能应用（内容为空或规则不适用）")
                if cleaning_rule_id:
                    if cln_rule_applied and cln_stats:
                        feedback_parts.append(
                            f"清洗规则「{cln_rule_name}」已应用"
                            f"（行数 {cln_stats.get('rows_before', '?')}→{cln_stats.get('rows_after', '?')}，"
                            f"字段数 {cln_stats.get('fields_before', '?')}→{cln_stats.get('fields_after', '?')}）"
                        )
                    else:
                        feedback_parts.append(f"清洗规则「{cln_rule_name}」未能应用（仅支持表格类型数据）")
                await self._reply_text(open_id, "\n".join(feedback_parts))
            else:
                await self._reply_text(open_id, f"重新入库失败：{result_msg}")

            card = self._build_result_card(
                task_id=task_id,
                input_type=input_type,
                preview=raw.get("preview", ""),
                asset_type=asset_type,
                llm_reason="用户手动调整",
                result_msg=result_msg,
                extraction_rules=extraction_rules,
                cleaning_rules=cleaning_rules,
                rec_ext_id=extraction_rule_id,
                rec_ext_name=ext_rule_name,
                rec_ext_reason="用户手动选择" if extraction_rule_id else "",
                rec_cln_id=cleaning_rule_id,
                rec_cln_name=cln_rule_name,
                rec_cln_reason="用户手动选择" if cleaning_rule_id else "",
            )
            await self._send_card(open_id, card)

        except Exception as e:
            logger.error("重新入库失败 [%s]: %s", task_id, e, exc_info=True)
            # 重置 task.status 以允许用户重试
            try:
                async with async_session() as db:
                    task = await self._get_task(db, task_id)
                    if task and task.status == "processing":
                        task.status = "failed"
                        task.result_message = f"重新入库失败: {str(e)[:200]}"
                        await db.commit()
            except Exception:
                pass
            await self._reply_text(open_id, f"重新入库失败：{str(e)[:200]}")

    # ── 删除记录 ──────────────────────────────────────────────

    async def _get_full_content(self, db: AsyncSession, record_id: int, record_type: str) -> str:
        """从数据库读取记录的完整内容文本（用于提取规则，需要完整内容以提取关键信息）。"""
        try:
            if record_type == "document":
                doc = await db.get(Document, record_id)
                if doc and doc.content_text:
                    return doc.content_text
            elif record_type == "communication":
                comm = await db.get(Communication, record_id)
                if comm:
                    return comm.content_text or comm.transcript or ""
        except Exception as e:
            logger.warning("读取完整内容失败 (%s id=%d): %s", record_type, record_id, e)
        return ""

    async def _get_record_content(self, db: AsyncSession, record_id: int, record_type: str) -> str:
        """从数据库读取记录的摘要/简短内容（用于自动打标）。"""
        try:
            if record_type == "document":
                doc = await db.get(Document, record_id)
                if doc:
                    return doc.summary or (doc.content_text or "")[:2000]
            elif record_type == "communication":
                comm = await db.get(Communication, record_id)
                if comm:
                    return comm.summary or (comm.content_text or "")[:2000]
        except Exception as e:
            logger.warning("读取记录内容失败 (%s id=%d): %s", record_type, record_id, e)
        return ""

    async def _delete_record(self, db: AsyncSession, record_id: int, record_type: str) -> None:
        """根据类型和 ID 删除入库记录及其关联的标签。"""
        # 先删除关联的 content_tags（无外键级联，需手动清理）
        from sqlalchemy import text as sql_text
        content_type_map = {
            "document": "document",
            "communication": "communication",
            "structured_table": "structured_table",
        }
        ct = content_type_map.get(record_type)
        if ct:
            await db.execute(
                sql_text("DELETE FROM content_tags WHERE content_type = :ct AND content_id = :cid"),
                {"ct": ct, "cid": record_id},
            )

        if record_type == "document":
            await db.execute(delete(Document).where(Document.id == record_id))
        elif record_type == "communication":
            await db.execute(delete(Communication).where(Communication.id == record_id))
        elif record_type == "structured_table":
            from app.models.structured_table import StructuredTable
            await db.execute(delete(StructuredTable).where(StructuredTable.id == record_id))
        await db.commit()

    # ── 各类型入库实现 ────────────────────────────────────────

    async def _ingest_text(
        self, text: str, owner_id: str, db: AsyncSession,
        asset_type: str, asset_owner_name: str | None,
    ) -> tuple[str, int | None, str | None]:
        """纯文字入库。Returns: (result_msg, record_id, record_type)"""
        if not text.strip():
            return "内容为空，未入库。", None, None

        now = datetime.utcnow()

        # LLM 解析
        parsed = {"title": text[:50], "summary": None, "tags": [], "category": None}
        if settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                parsed = await llm_client.parse_uploaded_file(text, "txt")
            except Exception as e:
                logger.warning("LLM 文本解析失败: %s", e)

        # Embedding
        embedding = None
        if settings.embedding_api_key and not settings.embedding_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                embedding = await llm_client.generate_embedding(
                    f"{parsed.get('title', '')} {text}".strip()[:2000]
                )
            except Exception as e:
                logger.warning("Embedding 生成失败: %s", e)

        keywords = parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else []

        if asset_type.startswith("comm_"):
            comm_type = asset_type.replace("comm_", "")
            comm = Communication(
                owner_id=owner_id,
                comm_type=comm_type,
                source_platform="feishu_bot",
                feishu_record_id=f"bot_{uuid.uuid4().hex[:16]}",
                title=parsed.get("title") or text[:50],
                content_text=text,
                summary=parsed.get("summary"),
                keywords=keywords,
                sentiment=parsed.get("sentiment"),
                asset_owner_name=asset_owner_name,
                parse_status="done",
                processed_at=now,
                synced_at=now,
            )
            if embedding:
                comm.content_vector = embedding
            db.add(comm)
            await db.flush()
            record_id = comm.id
            await db.commit()
            label = {"meeting": "会议记录", "chat": "聊天记录", "recording": "录音"}.get(comm_type, "沟通记录")
            return f"已作为{label}入库，标题: {comm.title}", record_id, "communication"
        else:
            valid_categories = {"report", "proposal", "policy", "technical"}
            doc = Document(
                owner_id=owner_id,
                source_type="local",
                title=parsed.get("title") or text[:50],
                content_text=text,
                summary=parsed.get("summary"),
                author=parsed.get("author"),
                keywords=keywords,
                doc_category=parsed.get("category") if parsed.get("category") in valid_categories else None,
                asset_owner_name=asset_owner_name,
                feishu_created_at=now,
                feishu_updated_at=now,
                synced_at=now,
            )
            if embedding:
                doc.content_vector = embedding
            db.add(doc)
            await db.flush()
            record_id = doc.id
            await db.commit()
            return f"已作为文档入库，标题: {doc.title}", record_id, "document"

    async def _ingest_file(
        self, file_key: str, file_name: str, owner_id: str,
        db: AsyncSession, asset_type: str, asset_owner_name: str | None,
        is_image: bool = False, message_id: str = "",
    ) -> tuple[str, int | None, str | None]:
        """文件入库。Returns: (result_msg, record_id, record_type)"""
        from app.services.file_upload import file_upload_service, FileUploadService

        if not file_key:
            return "文件 key 为空，无法下载。", None, None

        # 1. 下载文件
        try:
            resource_type = "image" if is_image else "file"
            file_bytes = await feishu_client.download_message_resource(
                message_id=message_id, file_key=file_key, resource_type=resource_type
            )
        except Exception as e:
            return f"文件下载失败: {e}", None, None

        # 2. 保存到本地
        ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin"
        user_dir = os.path.join(settings.upload_dir, owner_id)
        os.makedirs(user_dir, exist_ok=True)
        file_id = str(uuid.uuid4())
        file_path = os.path.join(user_dir, f"{file_id}.{ext}")
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        logger.info("机器人文件已保存: %s (%d bytes)", file_path, len(file_bytes))

        # 3. 音频文件
        if ext in FileUploadService.AUDIO_EXTENSIONS:
            try:
                transcript = await file_upload_service._transcribe_audio(file_path)
            except Exception as e:
                return f"音频转写失败: {e}", None, None

            parsed = {
                "title": None, "comm_type": "recording", "initiator": None,
                "participants": [], "summary": None, "conclusions": None,
                "action_items": [], "keywords": [], "sentiment": "neutral",
            }
            if settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
                try:
                    from app.services.llm import llm_client
                    parsed = await llm_client.parse_communication_doc(transcript)
                except Exception as e:
                    logger.warning("LLM 音频解析失败: %s", e)

            # 标题缺失或像文件名时，用 LLM 从内容生成
            from app.services.llm import looks_like_filename
            if looks_like_filename(parsed.get("title")):
                try:
                    from app.services.llm import llm_client as _llm
                    generated = await _llm.generate_title_from_content(transcript)
                    if generated:
                        parsed["title"] = generated
                except Exception as e:
                    logger.warning("LLM 生成标题失败: %s", e)

            embedding = None
            if settings.embedding_api_key and not settings.embedding_api_key.startswith("sk-xxx"):
                try:
                    from app.services.llm import llm_client
                    embedding = await llm_client.generate_embedding(
                        f"{parsed.get('title', '')} {transcript}"[:2000]
                    )
                except Exception:
                    pass

            comm = Communication(
                owner_id=owner_id,
                comm_type=parsed.get("comm_type") or "recording",
                source_platform="feishu_bot",
                feishu_record_id=f"bot_{file_id}",
                title=parsed.get("title") or file_name,
                content_text=transcript,
                transcript=transcript,
                summary=parsed.get("summary"),
                keywords=parsed.get("keywords") or [],
                sentiment=parsed.get("sentiment"),
                asset_owner_name=asset_owner_name,
                content_hash=hashlib.md5(file_bytes).hexdigest(),
                extra_fields={"file_path": file_path, "file_type": ext},
                parse_status="done",
                processed_at=datetime.utcnow(),
                synced_at=datetime.utcnow(),
            )
            if embedding:
                comm.content_vector = embedding
            db.add(comm)
            await db.flush()
            record_id = comm.id
            await db.commit()
            return f"音频已转写并入库，标题: {comm.title}", record_id, "communication"

        # 4. 表格文件
        if ext in {"xlsx", "xls", "csv", "tsv"}:
            from app.services.structured_table_import import import_from_local_file
            try:
                table_obj = await import_from_local_file(
                    db=db, owner_id=owner_id, file_name=file_name, file_content=file_bytes,
                )
                return (
                    f"表格文件已入库，表名: {table_obj.name}，共 {table_obj.row_count} 行",
                    table_obj.id, "structured_table",
                )
            except Exception as e:
                return f"表格文件入库失败: {e}", None, None

        # 5. 提取文本
        text_content = FileUploadService._extract_text(file_bytes, ext)
        if not text_content.strip():
            text_content = f"[{ext} 文件] {file_name}"

        parsed = {"title": file_name, "summary": None, "author": None, "tags": [], "category": None}
        if is_image and settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                parsed = await llm_client.parse_image_file(file_bytes, ext)
                text_content = parsed.get("content_text") or text_content
            except Exception as e:
                logger.warning("视觉模型图片解析失败: %s", e)
        elif settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                parsed = await llm_client.parse_uploaded_file(text_content, ext)
            except Exception as e:
                logger.warning("LLM 文件解析失败: %s", e)

        embedding = None
        if settings.embedding_api_key and not settings.embedding_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                embedding = await llm_client.generate_embedding(
                    f"{parsed.get('title', '')} {text_content}".strip()[:2000]
                )
            except Exception:
                pass

        keywords = parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else []
        now = datetime.utcnow()

        # 6. 按类型入库
        if asset_type.startswith("comm_"):
            comm_type = asset_type.replace("comm_", "")
            comm = Communication(
                owner_id=owner_id,
                comm_type=comm_type,
                source_platform="feishu_bot",
                feishu_record_id=f"bot_{file_id}",
                title=parsed.get("title") or file_name,
                content_text=text_content,
                summary=parsed.get("summary"),
                keywords=keywords,
                sentiment=parsed.get("sentiment"),
                asset_owner_name=asset_owner_name,
                content_hash=hashlib.md5(file_bytes).hexdigest(),
                extra_fields={"file_path": file_path, "file_type": ext},
                parse_status="done",
                processed_at=now,
                synced_at=now,
            )
            if embedding:
                comm.content_vector = embedding
            db.add(comm)
            await db.flush()
            record_id = comm.id
            await db.commit()
            label = {"meeting": "会议记录", "chat": "聊天记录", "recording": "录音"}.get(comm_type, "沟通记录")
            return f"文件已入库为{label}，标题: {comm.title}", record_id, "communication"
        else:
            valid_categories = {"report", "proposal", "policy", "technical"}
            doc = Document(
                owner_id=owner_id,
                source_type="local",
                original_filename=file_name,
                title=parsed.get("title") or file_name,
                content_text=text_content,
                summary=parsed.get("summary"),
                author=parsed.get("author"),
                keywords=keywords,
                doc_category=parsed.get("category") if parsed.get("category") in valid_categories else None,
                file_type=ext,
                file_size=len(file_bytes),
                file_path=file_path,
                asset_owner_name=asset_owner_name,
                feishu_created_at=now,
                feishu_updated_at=now,
                synced_at=now,
            )
            if embedding:
                doc.content_vector = embedding
            db.add(doc)
            await db.flush()
            record_id = doc.id
            await db.commit()
            return f"文件已入库为文档，标题: {doc.title}", record_id, "document"

    async def _ingest_web_url(
        self, url: str, owner_id: str, db: AsyncSession,
        asset_owner_name: str | None,
    ) -> tuple[str, int | None, str | None]:
        """抓取外网网页内容并入库为文档。"""
        if not url:
            return "URL 为空。", None, None

        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, verify=False) as client:
                resp = await client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; LiuguangBot/1.0)",
                })
                resp.raise_for_status()
                html = resp.text

            # 简单提取正文：去 HTML 标签
            import re as _re
            # 提取 <title>
            title_match = _re.search(r"<title[^>]*>(.*?)</title>", html, _re.IGNORECASE | _re.DOTALL)
            title = title_match.group(1).strip() if title_match else url[:100]
            # 去标签提取文本
            text = _re.sub(r"<script[^>]*>.*?</script>", "", html, flags=_re.IGNORECASE | _re.DOTALL)
            text = _re.sub(r"<style[^>]*>.*?</style>", "", text, flags=_re.IGNORECASE | _re.DOTALL)
            text = _re.sub(r"<[^>]+>", " ", text)
            text = _re.sub(r"\s+", " ", text).strip()

            if not text:
                return "网页内容为空，无法入库。", None, None

            # 截断过长内容
            if len(text) > 50000:
                text = text[:50000] + "...(内容已截断)"

            doc = Document(
                owner_id=owner_id,
                source_type="web",
                source_url=url,
                title=title[:500],
                content_text=text,
                asset_owner_name=asset_owner_name,
            )
            db.add(doc)
            await db.flush()
            record_id = doc.id
            await db.commit()
            return f"网页内容已入库为文档，标题: {title[:100]}", record_id, "document"
        except httpx.HTTPStatusError as e:
            return f"网页访问失败 (HTTP {e.response.status_code})，请确认链接是否可访问。", None, None
        except Exception as e:
            return f"网页抓取失败: {str(e)[:200]}", None, None

    async def _resolve_doc_owner(
        self, raw: dict, input_type: str, user_access_token: str,
        db: AsyncSession, fallback_owner_id: str, fallback_owner_name: str,
    ) -> tuple[str, str]:
        """查询飞书文档/多维表格的真实所有者，返回 (owner_id, owner_name)。

        如果所有者在流光平台有账号，返回其 open_id；否则 fallback 到发送者。
        """
        try:
            # 确定 token 和类型
            if input_type == "bitable":
                doc_token = raw.get("app_token", "")
                doc_type = "bitable"
            else:
                doc_token = raw.get("doc_token", "")
                doc_type = raw.get("feishu_doc_type", "docx")
                # wiki 类型也用 wiki
                if doc_type == "wiki":
                    doc_type = "wiki"

            if not doc_token:
                return fallback_owner_id, fallback_owner_name

            # wiki 类型先解析节点获取实际 token 和类型
            if doc_type == "wiki":
                try:
                    node = await feishu_client.get_wiki_node_info(
                        doc_token, user_access_token=user_access_token,
                    )
                    obj_type = node.get("obj_type", "doc")
                    obj_token = node.get("obj_token", doc_token)
                    # 映射 wiki obj_type 到 batch_get_doc_meta 的 doc_type
                    type_map = {"doc": "docx", "docx": "docx", "bitable": "bitable", "sheet": "sheet"}
                    doc_type = type_map.get(obj_type, "docx")
                    doc_token = obj_token
                    logger.info("resolve_doc_owner: wiki 解析 -> type=%s, token=%s", doc_type, doc_token)
                except Exception as e:
                    logger.warning("resolve_doc_owner: wiki 节点解析失败: %s", e)

            logger.info("resolve_doc_owner: 查询 meta token=%s, type=%s", doc_token, doc_type)
            meta_map = await feishu_client.batch_get_doc_meta(
                [{"token": doc_token, "type": doc_type}],
                user_access_token,
            )
            meta = meta_map.get(doc_token, {})
            doc_owner_id = meta.get("owner_id", "")
            doc_owner_name = meta.get("owner_name", "")
            logger.info("resolve_doc_owner: owner_id=%s, owner_name=%s", doc_owner_id, doc_owner_name)

            if not doc_owner_id:
                logger.info("文档 %s 未获取到 owner_id，使用发送者", doc_token)
                return fallback_owner_id, fallback_owner_name

            # 在流光平台查找文档所有者
            owner_user = await db.execute(
                select(User).where(User.feishu_open_id == doc_owner_id)
            )
            owner_user = owner_user.scalar_one_or_none()

            if owner_user:
                logger.info("文档 %s 实际所有者: %s (%s)", doc_token, owner_user.name, doc_owner_id)
                return doc_owner_id, owner_user.name or doc_owner_name
            else:
                logger.info("文档 %s 所有者 %s 不在平台，使用发送者", doc_token, doc_owner_id)
                return fallback_owner_id, fallback_owner_name

        except Exception as e:
            logger.warning("查询文档所有者失败: %s，使用发送者", e)
            return fallback_owner_id, fallback_owner_name

    _LOGIN_GUIDE = (
        "需要您先登录流光数据中台完成授权，机器人才能以您的身份访问飞书文档。\n"
        f"请点击登录：{settings.platform_url}/login\n"
        "登录后重新发送链接给我即可"
    )

    async def _ingest_cloud_doc(
        self, doc_token: str, owner_id: str, db: AsyncSession,
        asset_owner_name: str | None, user_access_token: str | None = None,
        feishu_doc_type: str = "docx", asset_type: str = "document",
        force: bool = False,
    ) -> tuple[str, int | None, str | None]:
        """飞书文档入库（支持云文档、知识库、电子表格等）。
        根据 asset_type 决定入库为 document 或 communication。
        force=True 时强制重新导入，不跳过已存在的记录。
        """
        if not doc_token:
            return "文档 token 为空。", None, None

        # wiki 类型需要先解析节点，获取实际文档类型和 token
        if feishu_doc_type == "wiki":
            try:
                node = await feishu_client.get_wiki_node_info(
                    doc_token, user_access_token=user_access_token,
                )
                obj_type = node.get("obj_type", "doc")
                obj_token = node.get("obj_token", doc_token)
                logger.info("Wiki 节点解析: node=%s -> type=%s, obj_token=%s", doc_token, obj_type, obj_token)

                # wiki 指向多维表格 → 走 bitable 入库
                if obj_type in ("bitable", "sheet") and obj_type == "bitable":
                    return await self._ingest_bitable(
                        obj_token, "", owner_id, db, asset_owner_name,
                        user_access_token=user_access_token,
                    )

                # 否则当作云文档处理
                doc_token = obj_token
            except Exception as e:
                logger.warning("Wiki 节点解析失败，尝试直接导入: %s", e)

        # 如果目标类型是 communication（如会议录音），先获取云文档内容再入库为 communication
        if asset_type.startswith("comm_"):
            return await self._ingest_cloud_doc_as_comm(
                doc_token, owner_id, db, asset_owner_name,
                user_access_token=user_access_token,
                asset_type=asset_type,
            )

        from app.services.cloud_doc_import import cloud_doc_import_service
        try:
            doc, status = await cloud_doc_import_service.import_cloud_doc(
                document_id=doc_token,
                owner_id=owner_id,
                db=db,
                user_access_token=user_access_token,
                asset_owner_name=asset_owner_name,
                force=force,
                source_platform="feishu_bot",
            )

            if status == "imported" and doc:
                return f"云文档已入库，标题: {doc.title}", doc.id, "document"
            elif status == "skipped" and doc:
                return f"云文档已存在（之前已导入），标题: {doc.title}", doc.id, "document"
            else:
                return "云文档导入失败，请确认文档链接是否正确或您是否已登录流光平台。", None, None
        except Exception as e:
            logger.error("云文档导入异常: %s", e, exc_info=True)
            return f"云文档导入失败: {e}", None, None

    async def _ingest_cloud_doc_as_comm(
        self, doc_token: str, owner_id: str, db: AsyncSession,
        asset_owner_name: str | None, user_access_token: str | None = None,
        asset_type: str = "comm_recording",
    ) -> tuple[str, int | None, str | None]:
        """将云文档内容提取后入库为 Communication（如会议录音）。"""
        # 1. 获取云文档内容
        try:
            doc_data = await feishu_client.get_document_content(
                doc_token, user_access_token=user_access_token,
            )
            raw_content = doc_data.get("content_text", "")
            doc_title = doc_data.get("title", "")
        except Exception as e:
            logger.error("获取云文档内容失败: %s", e, exc_info=True)
            return f"获取云文档内容失败: {e}", None, None

        if not raw_content or not raw_content.strip():
            return "云文档内容为空，无法入库。", None, None

        comm_type = asset_type.replace("comm_", "")
        now = datetime.utcnow()

        # 2. LLM 解析
        parsed = {
            "title": None, "comm_type": comm_type, "summary": None,
            "keywords": [], "sentiment": "neutral",
        }
        if settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                parsed = await llm_client.parse_communication_doc(raw_content)
                parsed.setdefault("comm_type", comm_type)
            except Exception as e:
                logger.warning("LLM 云文档解析失败: %s", e)

        # 标题优先使用云文档自带标题，其次 LLM 解析结果
        if doc_title and not parsed.get("title"):
            parsed["title"] = doc_title

        from app.services.llm import looks_like_filename
        if looks_like_filename(parsed.get("title")):
            try:
                from app.services.llm import llm_client as _llm
                generated = await _llm.generate_title_from_content(raw_content)
                if generated:
                    parsed["title"] = generated
            except Exception as e:
                logger.warning("LLM 生成标题失败: %s", e)

        # 3. Embedding
        embedding = None
        if settings.embedding_api_key and not settings.embedding_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                embedding = await llm_client.generate_embedding(
                    f"{parsed.get('title', '')} {raw_content}"[:2000]
                )
            except Exception:
                pass

        # 4. 解析 comm_time
        comm_time = None
        if parsed.get("comm_time"):
            try:
                from dateutil.parser import parse as parse_dt
                comm_time = parse_dt(parsed["comm_time"])
            except Exception:
                pass

        # 5. 入库为 Communication（先清理同 feishu_record_id 的旧记录，防止唯一约束冲突）
        target_record_id = f"bot_doc_{doc_token}"
        existing_comm = await db.execute(
            select(Communication).where(Communication.feishu_record_id == target_record_id)
        )
        old_comm = existing_comm.scalar_one_or_none()
        if old_comm:
            await db.delete(old_comm)
            await db.flush()
            logger.info("已清理旧 communication (feishu_record_id=%s)", target_record_id)

        comm = Communication(
            owner_id=owner_id,
            comm_type=comm_type,
            source_platform="feishu_bot",
            source_app_token=f"bot_{doc_token}",
            feishu_record_id=target_record_id,
            title=parsed.get("title") or raw_content[:50],
            content_text=raw_content,
            transcript=raw_content,
            summary=parsed.get("summary"),
            conclusions=parsed.get("conclusions"),
            keywords=parsed.get("keywords") or [],
            sentiment=parsed.get("sentiment"),
            initiator=parsed.get("initiator"),
            participants=parsed.get("participants") or [],
            action_items=parsed.get("action_items") or [],
            duration_minutes=parsed.get("duration_minutes"),
            comm_time=comm_time,
            asset_owner_name=asset_owner_name,
            parse_status="done",
            processed_at=now,
            synced_at=now,
        )
        if embedding:
            comm.content_vector = embedding
        db.add(comm)
        await db.flush()
        record_id = comm.id
        await db.commit()

        label = {"meeting": "会议记录", "chat": "聊天记录", "recording": "录音"}.get(comm_type, "沟通记录")
        return f"云文档已作为{label}入库，标题: {comm.title}", record_id, "communication"

    async def _ingest_bitable(
        self, app_token: str, table_id: str, owner_id: str,
        db: AsyncSession, asset_owner_name: str | None,
        user_access_token: str | None = None,
    ) -> tuple[str, int | None, str | None]:
        """多维表格入库。"""
        if not app_token:
            return "多维表格 app_token 为空。", None, None

        from app.services.structured_table_import import import_from_bitable

        if not table_id:
            try:
                tables = await feishu_client.get_bitable_tables(
                    app_token, user_access_token=user_access_token,
                )
                if tables:
                    table_id = tables[0].get("table_id", "")
                else:
                    return "该多维表格没有数据表。", None, None
            except Exception as e:
                return f"获取多维表格信息失败: {e}", None, None

        try:
            table_obj = await import_from_bitable(
                db=db, owner_id=owner_id,
                app_token=app_token, table_id=table_id,
                user_access_token=user_access_token,
            )
            return (
                f"多维表格已入库，表名: {table_obj.name}，共 {table_obj.row_count} 行",
                table_obj.id, "structured_table",
            )
        except Exception as e:
            return f"多维表格导入失败: {e}", None, None

    # ── 卡片构建 ──────────────────────────────────────────────

    def _build_result_card(
        self,
        task_id: str,
        input_type: str,
        preview: str,
        asset_type: str,
        llm_reason: str,
        result_msg: str,
        extraction_rules: list,
        cleaning_rules: list,
        rec_ext_id: int = 0,
        rec_ext_name: str = "未使用",
        rec_ext_reason: str = "",
        rec_cln_id: int = 0,
        rec_cln_name: str = "未使用",
        rec_cln_reason: str = "",
    ) -> dict:
        """构建入库结果卡片 — 显示结果 + 可调整选项。"""
        type_labels = {"text": "文字消息", "file": "文件", "cloud_doc": "云文档", "bitable": "多维表格", "web_url": "网页链接"}
        asset_label = ASSET_TYPE_LABELS.get(asset_type, asset_type)
        page_path = ASSET_PAGE_MAP.get(asset_type, "/data-insights")
        platform_link = f"{settings.platform_url}{page_path}"

        # 所有可选的资产类型
        all_asset_options = [
            {"text": {"tag": "plain_text", "content": v}, "value": k}
            for k, v in ASSET_TYPE_LABELS.items()
        ]

        # 提取规则下拉选项
        extraction_options = [
            {"text": {"tag": "plain_text", "content": "不使用提取规则"}, "value": "0"},
        ]
        for rule in extraction_rules:
            extraction_options.append({
                "text": {"tag": "plain_text", "content": rule.name},
                "value": str(rule.id),
            })

        # 清洗规则下拉选项
        cleaning_options = [
            {"text": {"tag": "plain_text", "content": "不使用清洗规则"}, "value": "0"},
        ]
        for rule in cleaning_rules:
            cleaning_options.append({
                "text": {"tag": "plain_text", "content": rule.name},
                "value": str(rule.id),
            })

        # form 元素（下拉框预选 LLM 推荐的值）
        form_elements = [
            {
                "tag": "select_static",
                "name": "asset_type",
                "placeholder": {"tag": "plain_text", "content": "入库类型"},
                "initial_option": asset_type,
                "options": all_asset_options,
            },
            {
                "tag": "select_static",
                "name": "extraction_rule_id",
                "placeholder": {"tag": "plain_text", "content": "提取规则（可选）"},
                "initial_option": str(rec_ext_id),
                "options": extraction_options,
            },
            {
                "tag": "select_static",
                "name": "cleaning_rule_id",
                "placeholder": {"tag": "plain_text", "content": "清洗规则（可选）"},
                "initial_option": str(rec_cln_id),
                "options": cleaning_options,
            },
        ]

        # 按钮（仅保留重新入库）
        form_elements.append({
            "tag": "button",
            "text": {"tag": "plain_text", "content": "按以上选择重新入库（删除旧数据）"},
            "type": "danger",
            "action_type": "form_submit",
            "name": "readjust_btn",
            "value": {"action": "readjust", "task_id": task_id},
        })

        # 智能推荐摘要
        smart_summary = (
            f"**智能分类**: {asset_label}（{llm_reason}）\n"
            f"**提取规则**: {rec_ext_name}" + (f"（{rec_ext_reason}）" if rec_ext_reason and rec_ext_reason != "未使用" else "") + "\n"
            f"**清洗规则**: {rec_cln_name}" + (f"（{rec_cln_reason}）" if rec_cln_reason and rec_cln_reason != "未使用" else "")
        )

        card = {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": "流光数据中台 - 入库完成"},
                "template": "green",
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": (
                            f"**内容类型**: {type_labels.get(input_type, input_type)}\n"
                            f"**内容预览**: {preview}\n"
                            f"**入库结果**: {result_msg}"
                        ),
                    },
                },
                {"tag": "hr"},
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": smart_summary + f"\n\n👉 [前往流光数据中台查看]({platform_link})",
                    },
                },
                {
                    "tag": "note",
                    "elements": [
                        {
                            "tag": "lark_md",
                            "content": "如需调整，请在下方修改选项后点击重新入库按钮",
                        }
                    ],
                },
                {
                    "tag": "form",
                    "name": "result_form",
                    "elements": form_elements,
                },
            ],
        }

        return card

    def _build_status_card(self, title: str, message: str, template: str = "indigo") -> dict:
        """构建状态反馈卡片（替换原卡片）。"""
        return {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": f"流光数据中台 - {title}"},
                "template": template,
            },
            "elements": [
                {"tag": "div", "text": {"tag": "lark_md", "content": message}}
            ],
        }

    # ── 辅助方法 ──────────────────────────────────────────────

    async def _find_user(self, db: AsyncSession, open_id: str) -> User | None:
        result = await db.execute(select(User).where(User.feishu_open_id == open_id))
        return result.scalar_one_or_none()

    async def _get_user_access_token(self, user: User, db: AsyncSession) -> str | None:
        """获取用户的有效 access_token，过期则自动刷新。"""
        # 先直接试用存储的 token
        if user.feishu_access_token:
            try:
                # 用一个轻量 API 验证 token 是否有效
                async with httpx.AsyncClient(proxy=None, timeout=10.0, verify=False) as client:
                    resp = await client.get(
                        "https://open.feishu.cn/open-apis/authen/v1/user_info",
                        headers={"Authorization": f"Bearer {user.feishu_access_token}"},
                    )
                    data = resp.json()
                    if data.get("code") == 0:
                        return user.feishu_access_token
            except Exception:
                pass

        # token 无效，尝试用 refresh_token 刷新
        if user.feishu_refresh_token:
            try:
                new_tokens = await feishu_client.refresh_user_access_token(user.feishu_refresh_token)
                user.feishu_access_token = new_tokens["access_token"]
                user.feishu_refresh_token = new_tokens.get("refresh_token", user.feishu_refresh_token)
                await db.commit()
                logger.info("已刷新用户 %s 的 access_token", user.name)
                return user.feishu_access_token
            except Exception as e:
                logger.warning("刷新 user_access_token 失败: %s", e)

        return None

    async def _get_task(self, db: AsyncSession, task_id: str) -> BotMessageTask | None:
        result = await db.execute(
            select(BotMessageTask).where(BotMessageTask.task_id == task_id)
        )
        return result.scalar_one_or_none()

    async def _reply_text(self, open_id: str, text: str) -> None:
        try:
            await feishu_client.send_bot_message(
                receive_id=open_id,
                msg_type="text",
                content=json.dumps({"text": text}),
            )
        except Exception as e:
            logger.error("发送文字消息失败: %s", e)

    async def _send_card(self, open_id: str, card: dict) -> None:
        try:
            await feishu_client.send_bot_message(
                receive_id=open_id,
                msg_type="interactive",
                content=json.dumps(card),
            )
        except Exception as e:
            logger.error("发送卡片消息失败: %s", e)


# 模块级单例
feishu_bot_service = FeishuBotService()
