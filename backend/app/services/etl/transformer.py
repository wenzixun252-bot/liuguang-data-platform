"""ETL Transform 模块 — 三表路由 + Schema 映射缓存 + 3步增强工作流。"""

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.asset import SchemaMappingCache
from app.services.etl.enricher import content_enricher
from app.services.etl.extractor import ExtractionResult
from app.services.etl.postprocessor import content_postprocessor
from app.services.etl.preprocessor import content_preprocessor
from app.utils.feishu_webhook import send_alert

logger = logging.getLogger(__name__)

# 关键字段 — 缺失则丢弃该记录
REQUIRED_FIELDS = {"feishu_record_id", "owner_id", "content_text"}


# ── 三种目标表的转换结果 dataclass ────────────────────────

@dataclass
class TransformedDocument:
    """文档记录。"""
    feishu_record_id: str
    owner_id: str
    source_app_token: str
    source_table_id: str
    title: str | None = None
    content_text: str = ""
    summary: str | None = None
    author: str | None = None
    doc_url: str | None = None
    source_url: str | None = None
    source_platform: str | None = None
    uploader_name: str | None = None
    extra_fields: dict = field(default_factory=dict)
    attachments: list = field(default_factory=list)
    feishu_created_at: datetime | None = None
    feishu_updated_at: datetime | None = None
    # -- LLM 提取字段 --
    keywords: list = field(default_factory=list)
    involved_people: list = field(default_factory=list)
    sentiment: str | None = None
    # -- 后处理字段 --
    quality_score: float | None = None
    duplicate_of: int | None = None
    content_hash: str | None = None
    chunks: list[str] = field(default_factory=list)


@dataclass
class TransformedMeeting:
    """会议记录。"""
    feishu_record_id: str
    owner_id: str
    source_app_token: str
    source_table_id: str
    title: str | None = None
    meeting_time: datetime | None = None
    duration_minutes: int | None = None
    location: str | None = None
    organizer: str | None = None
    participants: list = field(default_factory=list)
    agenda: str | None = None
    conclusions: str | None = None
    action_items: list = field(default_factory=list)
    content_text: str = ""
    summary: str | None = None
    transcript: str | None = None
    recording_url: str | None = None
    minutes_url: str | None = None
    source_url: str | None = None
    source_platform: str | None = None
    uploader_name: str | None = None
    extra_fields: dict = field(default_factory=dict)
    attachments: list = field(default_factory=list)
    feishu_created_at: datetime | None = None
    feishu_updated_at: datetime | None = None
    # -- LLM 提取字段 --
    keywords: list = field(default_factory=list)
    involved_people: list = field(default_factory=list)
    sentiment: str | None = None
    # -- 后处理字段 --
    quality_score: float | None = None
    duplicate_of: int | None = None
    content_hash: str | None = None
    chunks: list[str] = field(default_factory=list)


@dataclass
class TransformedChatMessage:
    """聊天消息。"""
    feishu_record_id: str
    owner_id: str
    source_app_token: str
    source_table_id: str
    chat_id: str | None = None
    chat_type: str | None = None
    chat_name: str | None = None
    sender: str | None = None
    message_type: str | None = None
    content_text: str = ""
    summary: str | None = None
    sent_at: datetime | None = None
    reply_to: str | None = None
    mentions: list = field(default_factory=list)
    source_url: str | None = None
    source_platform: str | None = None
    uploader_name: str | None = None
    extra_fields: dict = field(default_factory=dict)
    attachments: list = field(default_factory=list)
    # -- LLM 提取字段 --
    keywords: list = field(default_factory=list)
    involved_people: list = field(default_factory=list)
    sentiment: str | None = None
    # -- 后处理字段 --
    quality_score: float | None = None
    duplicate_of: int | None = None
    content_hash: str | None = None
    chunks: list[str] = field(default_factory=list)


@dataclass
class TransformResult:
    """转换结果。"""
    records: list = field(default_factory=list)
    target_table: str = "documents"
    discarded_count: int = 0
    app_token: str = ""
    table_id: str = ""


# ── 三套规则关键词映射 ──────────────────────────────────────

DOCUMENT_KEYWORDS: dict[str, list[str]] = {
    "title": ["标题", "文件名", "名称", "title", "name", "主题"],
    "content_text": ["内容", "正文", "content", "核心内容", "摘要", "描述", "详情"],
    "owner_id": ["所有者", "创建者", "作者", "负责人", "owner", "creator", "文件所有者"],
    "feishu_record_id": ["标识", "record_id", "id", "文件标识"],
    "author": ["作者", "作成者", "author", "writer"],
    "doc_url": ["文档链接", "文件链接", "链接", "URL", "url", "doc_url", "文档地址"],
    "feishu_created_at": ["创建时间", "created", "创建日期", "文件创建时间"],
    "feishu_updated_at": ["修改时间", "更新时间", "updated", "最近修改", "文件最近修改时间"],
}

MEETING_KEYWORDS: dict[str, list[str]] = {
    "title": ["标题", "会议主题", "主题", "title", "name"],
    "content_text": ["内容", "纪要", "content", "会议记录", "详情", "正文"],
    "owner_id": ["所有者", "创建者", "组织者", "owner", "creator"],
    "feishu_record_id": ["标识", "record_id", "id"],
    "meeting_time": ["会议时间", "开始时间", "时间", "meeting_time", "start_time"],
    "duration_minutes": ["时长", "持续", "duration"],
    "location": ["地点", "会议室", "location"],
    "organizer": ["组织者", "发起人", "organizer"],
    "participants": ["参与人", "参会人", "与会者", "participants", "attendees"],
    "agenda": ["议程", "agenda"],
    "conclusions": ["结论", "决议", "conclusion"],
    "action_items": ["待办", "行动项", "action_items", "todo"],
    "minutes_url": ["完整会议纪要", "会议纪要链接", "纪要链接", "会议纪要", "minutes_url", "纪要", "会议链接"],
    "recording_url": ["录音", "录音链接", "recording", "音频", "录像"],
    "transcript": ["转写", "转写文本", "transcript", "录音文字", "语音转文字"],
    "feishu_created_at": ["创建时间", "created"],
    "feishu_updated_at": ["修改时间", "更新时间", "updated"],
}

CHAT_MESSAGE_KEYWORDS: dict[str, list[str]] = {
    "content_text": ["聊天记录", "消息内容", "内容", "消息", "message", "content", "正文", "text"],
    "owner_id": ["所有者", "创建者", "owner", "creator", "配方 Owner"],
    "feishu_record_id": ["消息ID", "标识", "record_id", "id", "msg_id"],
    "chat_id": ["所在群", "会话", "群组", "chat_id", "group", "群名"],
    "chat_type": ["聊天类型", "会话类型", "chat_type", "类型"],
    "chat_name": ["群名", "群名称", "群组名", "chat_name", "group_name"],
    "sender": ["发送人", "发送者", "sender", "from"],
    "message_type": ["消息类型", "类型", "type", "message_type"],
    "sent_at": ["发送时间", "时间", "sent_at", "send_time"],
    "reply_to": ["话题回复内容", "回复", "reply", "reply_to"],
    "mentions": ["提及", "@", "mentions"],
}

# asset_type -> target_table 映射
ASSET_TYPE_TO_TABLE = {
    "document": "documents",
    "meeting": "meetings",
    "chat_message": "chat_messages",
}

# asset_type -> 关键词字典
ASSET_TYPE_TO_KEYWORDS = {
    "document": DOCUMENT_KEYWORDS,
    "meeting": MEETING_KEYWORDS,
    "chat_message": CHAT_MESSAGE_KEYWORDS,
}


class DataTransformer:
    """Schema 映射缓存 + 3步增强工作流，支持三表路由。"""

    async def transform(
        self,
        extraction: ExtractionResult,
        asset_type: str,
        db: AsyncSession,
        owner_id: str | None = None,
    ) -> TransformResult:
        """对抽取结果执行 Schema 映射 + 3步增强工作流。"""
        target_table = ASSET_TYPE_TO_TABLE.get(asset_type, "documents")

        if not extraction.records:
            return TransformResult(
                app_token=extraction.app_token,
                table_id=extraction.table_id,
                target_table=target_table,
            )

        # 1. 获取 Schema 映射（带缓存）
        try:
            mapping = await self._get_or_create_mapping(
                extraction.schema_fields,
                extraction.app_token,
                extraction.table_id,
                asset_type,
                db,
            )
        except LLMError as e:
            logger.error("Schema 映射失败，跳过本表: %s", e)
            await send_alert(
                f"Schema 映射失败: {extraction.table_id}",
                f"数据源: `{extraction.app_token}/{extraction.table_id}`\n错误: {e}",
            )
            return TransformResult(
                app_token=extraction.app_token,
                table_id=extraction.table_id,
                target_table=target_table,
            )

        # 2. 逐条转换 + 3步增强
        transformed: list = []
        discarded = 0

        for raw_record in extraction.records:
            record = self._apply_mapping(
                raw_record, mapping, extraction.app_token, extraction.table_id, asset_type,
                default_owner_id=owner_id,
            )
            if record is None:
                discarded += 1
                continue

            # ── Step 1: 规则预处理 ──
            record.content_text = content_preprocessor.process(record.content_text)
            if not record.content_text:
                discarded += 1
                continue

            # ── Step 2: LLM 智能提取 ──
            enrich_result = await content_enricher.enrich(
                record.content_text,
                asset_type,
                title=getattr(record, "title", None),
            )
            record.summary = enrich_result.summary
            record.keywords = enrich_result.keywords
            record.involved_people = enrich_result.involved_people
            record.sentiment = enrich_result.sentiment

            # 尝试关联用户 ID
            if enrich_result.involved_people:
                record.involved_people = await content_enricher.resolve_people_ids(
                    enrich_result.involved_people, db,
                )

            # ── Step 3: 程序后处理 ──
            record.quality_score = content_postprocessor.compute_quality_score(
                record.content_text,
                title=getattr(record, "title", None),
                summary=record.summary,
                keywords=record.keywords,
                involved_people=record.involved_people,
            )
            record.content_hash = content_postprocessor.compute_content_hash(record.content_text)
            record.chunks = content_postprocessor.split_chunks(record.content_text)

            # 设置 source_platform
            record.source_platform = "feishu"

            # 设置 source_url
            if hasattr(record, "doc_url") and record.doc_url:
                record.source_url = record.doc_url
            elif hasattr(record, "minutes_url") and record.minutes_url:
                record.source_url = record.minutes_url

            transformed.append(record)

        if discarded > 0:
            logger.warning(
                "数据源 %s/%s: 丢弃 %d 条关键字段缺失的记录",
                extraction.app_token,
                extraction.table_id,
                discarded,
            )
            await send_alert(
                f"ETL 数据清洗告警: {extraction.table_id}",
                f"数据源: `{extraction.app_token}/{extraction.table_id}`\n"
                f"丢弃 {discarded} 条关键字段缺失的记录",
            )

        logger.info(
            "数据转换完成: %s/%s -> %s, 有效 %d 条, 丢弃 %d 条",
            extraction.app_token,
            extraction.table_id,
            target_table,
            len(transformed),
            discarded,
        )

        return TransformResult(
            records=transformed,
            target_table=target_table,
            discarded_count=discarded,
            app_token=extraction.app_token,
            table_id=extraction.table_id,
        )

    # ── Schema 映射缓存 ─────────────────────────────────

    def _rule_based_mapping(self, schema_fields: list[dict], asset_type: str) -> dict:
        """基于关键词匹配的规则映射（不依赖 LLM）。"""
        keywords = ASSET_TYPE_TO_KEYWORDS.get(asset_type, DOCUMENT_KEYWORDS)
        field_names = [f.get("field_name", "") for f in schema_fields]
        mapping: dict[str, str] = {}

        for target, kws in keywords.items():
            for kw in kws:
                for fn in field_names:
                    if fn == kw:
                        mapping[target] = fn
                        break
                if target in mapping:
                    break
            if target not in mapping:
                for kw in kws:
                    for fn in field_names:
                        if kw in fn:
                            mapping[target] = fn
                            break
                    if target in mapping:
                        break

        logger.info("规则映射结果 (%s): %s", asset_type, mapping)
        return mapping

    async def _get_or_create_mapping(
        self,
        schema_fields: list[dict],
        app_token: str,
        table_id: str,
        asset_type: str,
        db: AsyncSession,
    ) -> dict:
        """获取 Schema 映射，优先从缓存读取，无 LLM 时降级为规则映射。"""
        schema_json = json.dumps(schema_fields, sort_keys=True, ensure_ascii=False)
        schema_md5 = hashlib.md5(schema_json.encode()).hexdigest()

        result = await db.execute(
            select(SchemaMappingCache).where(
                SchemaMappingCache.source_app_token == app_token,
                SchemaMappingCache.source_table_id == table_id,
                SchemaMappingCache.schema_md5 == schema_md5,
            )
        )
        cached = result.scalar_one_or_none()

        if cached is not None:
            logger.info("Schema 映射缓存命中: %s/%s (md5=%s)", app_token, table_id, schema_md5)
            return cached.mapping_result

        rule_mapping = self._rule_based_mapping(schema_fields, asset_type)
        logger.info("规则映射结果: %s", rule_mapping)

        if settings.llm_api_key and not settings.llm_api_key.startswith("sk-xxx"):
            try:
                from app.services.llm import llm_client
                logger.info("Schema 映射缓存未命中，调用 LLM 补充: %s/%s", app_token, table_id)
                llm_mapping = await llm_client.schema_mapping(schema_fields, target_table=asset_type)
                mapping = {**llm_mapping, **rule_mapping}
                logger.info("合并映射结果 (规则优先): %s", mapping)
            except Exception as e:
                logger.warning("LLM 映射失败，使用纯规则映射: %s", e)
                mapping = rule_mapping
        else:
            logger.info("LLM 未配置，使用规则映射: %s/%s", app_token, table_id)
            mapping = rule_mapping

        cache_entry = SchemaMappingCache(
            source_app_token=app_token,
            source_table_id=table_id,
            schema_md5=schema_md5,
            mapping_result=mapping,
        )
        db.add(cache_entry)
        await db.commit()

        return mapping

    # ── 数据转换 ─────────────────────────────────────────

    def _apply_mapping(
        self,
        raw_record: dict,
        mapping: dict,
        app_token: str,
        table_id: str,
        asset_type: str,
        default_owner_id: str | None = None,
    ):
        """按映射规则将源记录转换为目标 dataclass 实例。"""
        fields = raw_record.get("fields", {})
        record_id = raw_record.get("record_id", "")

        mapped_values: dict = {}
        mapped_source_fields: set = set()

        for target_field, source_field in mapping.items():
            if source_field and source_field in fields:
                mapped_values[target_field] = fields[source_field]
                mapped_source_fields.add(source_field)

        feishu_record_id = str(mapped_values.get("feishu_record_id", record_id or ""))
        owner_id = default_owner_id or ""
        raw_owner = mapped_values.get("owner_id", "")
        original_owner_info = None
        if raw_owner:
            original_owner_id = self._extract_owner_id(raw_owner)
            original_owner_name = self._extract_owner_name(raw_owner)
            if original_owner_id or original_owner_name:
                original_owner_info = {"id": original_owner_id, "name": original_owner_name}
        content_text = self._extract_text(mapped_values.get("content_text", ""))

        if not feishu_record_id or not owner_id or not content_text:
            logger.warning(
                "记录缺少关键字段 (record_id=%s, owner_id=%s, content_text=%s)，丢弃",
                bool(feishu_record_id),
                bool(owner_id),
                bool(content_text),
            )
            return None

        extra_fields: dict = {}
        for source_field, value in fields.items():
            if source_field not in mapped_source_fields:
                extra_fields[source_field] = value

        if original_owner_info:
            extra_fields["_original_owner"] = original_owner_info

        attachments: list[dict] = []
        for _field_name, value in fields.items():
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict) and "file_token" in item:
                        attachments.append({
                            "file_token": item["file_token"],
                            "name": item.get("name", ""),
                            "size": item.get("size", 0),
                            "type": item.get("type", ""),
                        })

        links: list[dict] = []
        for field_name, value in fields.items():
            if isinstance(value, dict) and "link" in value:
                links.append({
                    "field_name": field_name,
                    "text": value.get("text", ""),
                    "link": value["link"],
                })
            elif isinstance(value, str) and value.startswith(("http://", "https://")):
                links.append({
                    "field_name": field_name,
                    "text": field_name,
                    "link": value,
                })
        if links:
            extra_fields["_links"] = links

        title = self._extract_text(mapped_values.get("title"))

        if asset_type == "meeting":
            return TransformedMeeting(
                feishu_record_id=feishu_record_id,
                owner_id=owner_id,
                source_app_token=app_token,
                source_table_id=table_id,
                title=title,
                meeting_time=self._parse_time(mapped_values.get("meeting_time")),
                duration_minutes=self._extract_int(mapped_values.get("duration_minutes")),
                location=self._extract_text(mapped_values.get("location")),
                organizer=self._extract_text(mapped_values.get("organizer")),
                participants=self._extract_list(mapped_values.get("participants")),
                agenda=self._extract_text(mapped_values.get("agenda")),
                conclusions=self._extract_text(mapped_values.get("conclusions")),
                action_items=self._extract_list(mapped_values.get("action_items")),
                content_text=content_text,
                transcript=self._extract_text(mapped_values.get("transcript")),
                recording_url=self._extract_url(mapped_values.get("recording_url")),
                minutes_url=self._extract_url(mapped_values.get("minutes_url")),
                extra_fields=extra_fields,
                attachments=attachments,
                feishu_created_at=self._parse_time(mapped_values.get("feishu_created_at")),
                feishu_updated_at=self._parse_time(mapped_values.get("feishu_updated_at")),
            )
        elif asset_type == "chat_message":
            return TransformedChatMessage(
                feishu_record_id=feishu_record_id,
                owner_id=owner_id,
                source_app_token=app_token,
                source_table_id=table_id,
                chat_id=self._extract_text(mapped_values.get("chat_id")),
                chat_type=self._extract_text(mapped_values.get("chat_type")) or None,
                chat_name=self._extract_text(mapped_values.get("chat_name")) or None,
                sender=self._extract_text(mapped_values.get("sender")),
                message_type=self._extract_text(mapped_values.get("message_type")),
                content_text=content_text,
                sent_at=self._parse_time(mapped_values.get("sent_at")),
                reply_to=self._extract_text(mapped_values.get("reply_to")),
                mentions=self._extract_list(mapped_values.get("mentions")),
                extra_fields=extra_fields,
                attachments=attachments,
            )
        else:
            return TransformedDocument(
                feishu_record_id=feishu_record_id,
                owner_id=owner_id,
                source_app_token=app_token,
                source_table_id=table_id,
                title=title,
                content_text=content_text,
                author=self._extract_text(mapped_values.get("author")),
                doc_url=self._extract_url(mapped_values.get("doc_url")),
                extra_fields=extra_fields,
                attachments=attachments,
                feishu_created_at=self._parse_time(mapped_values.get("feishu_created_at")),
                feishu_updated_at=self._parse_time(mapped_values.get("feishu_updated_at")),
            )

    @staticmethod
    def _extract_owner_id(value) -> str:
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, dict):
                return first.get("id", first.get("open_id", ""))
        if isinstance(value, dict):
            return value.get("id", value.get("open_id", ""))
        if isinstance(value, str):
            return value.strip()
        return ""

    @staticmethod
    def _extract_owner_name(value) -> str:
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, dict):
                return first.get("name", first.get("en_name", ""))
        if isinstance(value, dict):
            return value.get("name", value.get("en_name", ""))
        return ""

    @staticmethod
    def _extract_url(value) -> str:
        if value is None:
            return ""
        if isinstance(value, dict):
            return value.get("link", value.get("url", ""))
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value.strip()
        return ""

    @staticmethod
    def _extract_text(value) -> str:
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

    @staticmethod
    def _extract_int(value) -> int | None:
        if value is None:
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            try:
                return int(value)
            except ValueError:
                return None
        return None

    @staticmethod
    def _extract_list(value) -> list:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        return []

    @staticmethod
    def _parse_time(value) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return datetime.utcfromtimestamp(value / 1000)
        if isinstance(value, str):
            try:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return dt.replace(tzinfo=None)
            except ValueError:
                return None
        return None


class LLMError(Exception):
    """LLM 调用异常（本地使用，避免循环导入）。"""


# 模块级单例
data_transformer = DataTransformer()
