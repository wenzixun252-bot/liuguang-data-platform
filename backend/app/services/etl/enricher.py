"""ETL Step 2: LLM 智能提取 — 一次调用提取 summary/keywords/sentiment。"""

import asyncio
import json
import logging
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

logger = logging.getLogger(__name__)

# 内容类型的中文描述，用于 prompt
CONTENT_TYPE_LABELS = {
    "document": "文档",
    "communication": "沟通记录",
    "structured_table": "结构化数据表",
    # 兼容旧值
    "meeting": "会议纪要",
    "chat_message": "聊天记录",
}

ENRICH_PROMPT = """你是一个数据分析专家。请分析以下{content_type_label}内容，提取结构化信息。

## 内容
{content}

## 要求
1. summary: 生成100-200字的摘要，准确概括核心内容
2. keywords: 提取5-10个关键词/主题词，按重要性排序
3. sentiment: 判断整体情感倾向
{category_instruction}

## 输出格式（仅输出 JSON）
{{
  "summary": "摘要文本",
  "keywords": ["关键词1", "关键词2"],
  "sentiment": "positive"{category_json_field}
}}

sentiment 只能是: positive / neutral / negative
只输出 JSON，不要输出其他内容。"""

MAX_RETRIES = 3
MAX_CONTENT_LEN = 6000  # 截断长内容，避免超 token


@dataclass
class EnrichResult:
    """LLM 提取结果。"""
    summary: str | None = None
    keywords: list[str] = field(default_factory=list)
    sentiment: str | None = None
    doc_category: str | None = None
    table_category: str | None = None
    key_info: dict | None = None


class ContentEnricher:
    """LLM 智能提取器：一次调用提取四个维度的结构化信息。"""

    async def enrich(
        self,
        content_text: str,
        content_type: str,
        title: str | None = None,
    ) -> EnrichResult:
        """调用 LLM 提取 summary/keywords/people/sentiment。"""
        if not content_text or not content_text.strip():
            return EnrichResult()

        if not settings.llm_api_key or settings.llm_api_key.startswith("sk-xxx"):
            logger.info("LLM 未配置，跳过内容增强")
            return EnrichResult()

        # 构建输入：标题 + 内容
        full_text = content_text
        if title:
            full_text = f"标题: {title}\n\n{content_text}"

        # 截断过长内容
        if len(full_text) > MAX_CONTENT_LEN:
            full_text = full_text[:MAX_CONTENT_LEN] + "\n...(内容已截断)"

        content_type_label = CONTENT_TYPE_LABELS.get(content_type, "内容")

        # 分类指令
        category_instruction = ""
        category_json_field = ""
        if content_type == "document":
            category_instruction = (
                '4. doc_category: 判断文档属于以下哪个分类（只能选一个）\n'
                '   - report: 行业报告、研究报告、市场分析\n'
                '   - proposal: 项目方案、提案、计划书\n'
                '   - policy: 规章制度、流程规范、公司政策\n'
                '   - technical: 技术文档、API文档、设计文档\n'
                '   如果无法判断，返回 null'
            )
            category_json_field = ',\n  "doc_category": "report"'
        elif content_type == "structured_table":
            category_instruction = (
                '4. table_category: 判断该表格数据属于什么业务领域\n'
                '   例如: finance(财务) / sales(销售) / attendance(考勤) / kpi(绩效) / hr(人力) / inventory(库存)\n'
                '   返回一个小写英文单词，如果无法判断返回 null'
            )
            category_json_field = ',\n  "table_category": "finance"'

        prompt = ENRICH_PROMPT.format(
            content_type_label=content_type_label,
            content=full_text,
            category_instruction=category_instruction,
            category_json_field=category_json_field,
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                from app.services.llm import llm_client
                response = await asyncio.wait_for(
                    llm_client.chat_client.chat.completions.create(
                        model=settings.llm_model,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.0,
                    ),
                    timeout=30,
                )
                result_text = response.choices[0].message.content.strip()

                # 提取 JSON
                if "```" in result_text:
                    result_text = result_text.split("```")[1]
                    if result_text.startswith("json"):
                        result_text = result_text[4:]
                    result_text = result_text.strip()

                parsed = json.loads(result_text)
                logger.info("内容增强成功 (第 %d 次尝试, type=%s)", attempt, content_type)

                return EnrichResult(
                    summary=parsed.get("summary"),
                    keywords=parsed.get("keywords", []),
                    sentiment=self._validate_sentiment(parsed.get("sentiment")),
                    doc_category=self._validate_doc_category(parsed.get("doc_category")),
                    table_category=parsed.get("table_category"),
                )
            except (json.JSONDecodeError, IndexError, KeyError) as e:
                logger.warning("内容增强 JSON 解析失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return EnrichResult()
            except Exception as e:
                logger.warning("内容增强 LLM 调用失败 (第 %d/%d 次): %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return EnrichResult()

        return EnrichResult()

    @staticmethod
    def _validate_sentiment(value: str | None) -> str | None:
        """校验 sentiment 值。"""
        if value in ("positive", "neutral", "negative"):
            return value
        return None

    @staticmethod
    def _validate_doc_category(value: str | None) -> str | None:
        """校验 doc_category 值。"""
        if value in ("report", "proposal", "policy", "technical"):
            return value
        return None


# 模块级单例
content_enricher = ContentEnricher()


# ── 提取规则：关键信息提取 ─────────────────────────────────

KEY_INFO_PROMPT = """你是一个数据分析专家。请从以下内容中，按照指定的字段定义提取关键信息。

## 重要提取规则
1. **标题是最重要的信息来源**：如果内容以"标题:"开头，标题中通常包含项目名称、公司名称等核心信息，必须优先从标题中提取。
2. 结合标题和正文内容综合提取，尽量不要返回 null。
3. 如果正文内容较少，应基于标题和已有信息做合理推断。

## 内容
{content}

## 需要提取的字段
{fields_desc}
{hint_section}
## 输出格式（仅输出 JSON）
请输出一个 JSON 对象，key 为字段的中文名称，value 为提取到的值。
如果某个字段确实无法从标题和内容中获取，对应 value 设为 null。
只输出 JSON，不要输出其他内容。"""


async def extract_key_info(
    content_text: str,
    extraction_rule_id: int | None,
    db: AsyncSession,
    title: str | None = None,
    original_filename: str | None = None,
) -> dict | None:
    """根据提取规则，使用 LLM 从内容中提取关键信息字段。

    Args:
        content_text: 要提取信息的文本内容。
        extraction_rule_id: 提取规则 ID，为 None 时直接返回 None。
        db: 数据库会话。
        title: 文档/资产标题，会拼在内容前面帮助 LLM 更准确提取。
        original_filename: 原始文件名，通常包含更完整的项目名称等信息。

    Returns:
        提取到的关键信息 dict，或 None。
    """
    if extraction_rule_id is None:
        return None

    if not content_text or not content_text.strip():
        return None

    if not settings.llm_api_key or settings.llm_api_key.startswith("sk-xxx"):
        logger.info("LLM 未配置，跳过关键信息提取")
        return None

    # 加载提取规则：支持内置规则（负数 ID）和数据库规则
    if extraction_rule_id < 0:
        from app.services.builtin_rules import get_builtin_extraction_rule
        builtin = get_builtin_extraction_rule(extraction_rule_id)
        if builtin is None:
            logger.warning("内置提取规则 ID=%d 不存在，跳过关键信息提取", extraction_rule_id)
            return None
        from types import SimpleNamespace
        rule = SimpleNamespace(**builtin)
    else:
        try:
            from sqlalchemy import select
            from app.models.extraction_rule import ExtractionRule

            result = await db.execute(
                select(ExtractionRule).where(ExtractionRule.id == extraction_rule_id)
            )
            rule = result.scalar_one_or_none()
            if rule is None:
                logger.warning("提取规则 ID=%d 不存在，跳过关键信息提取", extraction_rule_id)
                return None
        except Exception as e:
            logger.warning("加载提取规则失败 (id=%d): %s", extraction_rule_id, e)
            return None

    # 构建字段描述
    fields = rule.fields or []
    if not fields:
        logger.info("提取规则 ID=%d 无字段定义，跳过", extraction_rule_id)
        return None

    fields_lines = []
    for f in fields:
        label = f.get("label", "")
        desc = f.get("description", "")
        line = f"- {label}"
        if desc:
            line += f": {desc}"
        fields_lines.append(line)
    fields_desc = "\n".join(fields_lines)

    # prompt_hint
    hint_section = ""
    if rule.prompt_hint:
        hint_section = f"\n## 额外提示\n{rule.prompt_hint}\n"

    # 将标题和原始文件名拼在内容前面，帮助 LLM 理解上下文
    header_parts = []
    if title:
        header_parts.append(f"标题: {title}")
    if original_filename and original_filename != title:
        header_parts.append(f"原始文件名: {original_filename}")
    full_text = "\n".join(header_parts) + "\n\n" + content_text if header_parts else content_text
    logger.info("关键信息提取: title=%s, original_filename=%s, content前100字=%s", title, original_filename, full_text[:100])

    # 截断过长内容
    truncated = full_text
    if len(truncated) > MAX_CONTENT_LEN:
        truncated = truncated[:MAX_CONTENT_LEN] + "\n...(内容已截断)"

    prompt = KEY_INFO_PROMPT.format(
        content=truncated,
        fields_desc=fields_desc,
        hint_section=hint_section,
    )

    try:
        from app.services.llm import llm_client
        response = await asyncio.wait_for(
            llm_client.chat_client.chat.completions.create(
                model=settings.llm_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
            ),
            timeout=30,
        )
        result_text = response.choices[0].message.content.strip()

        # 提取 JSON
        if "```" in result_text:
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
            result_text = result_text.strip()

        parsed = json.loads(result_text)

        # 后处理：确保 key 都是中文 label，而非自动生成的 field_xxx
        key_to_label = {f.get("key", ""): f.get("label", "") for f in fields}
        translated = {}
        for k, v in parsed.items():
            if k in key_to_label and key_to_label[k]:
                translated[key_to_label[k]] = v
            else:
                translated[k] = v

        logger.info("关键信息提取成功 (rule_id=%d, fields=%d)", extraction_rule_id, len(translated))
        return translated
    except (json.JSONDecodeError, IndexError, KeyError) as e:
        logger.warning("关键信息提取 JSON 解析失败 (rule_id=%d): %s", extraction_rule_id, e)
        return None
    except Exception as e:
        logger.warning("关键信息提取 LLM 调用失败 (rule_id=%d): %s", extraction_rule_id, e)
        return None


async def translate_key_info_batch(
    items: list,
    db: AsyncSession,
) -> None:
    """批量将 key_info 中的 field_xxx key 翻译为中文 label（原地修改）。

    遍历 items，对每个有 extraction_rule_id 和 key_info 的对象，
    根据提取规则的 fields 定义将 key 从自动生成的 field_xxx 替换为中文 label。
    """
    from sqlalchemy import select as sa_select
    from app.models.extraction_rule import ExtractionRule
    from app.services.builtin_rules import get_builtin_extraction_rule

    # 收集需要翻译的 rule_id
    rule_ids = set()
    builtin_rule_ids = set()
    for item in items:
        rule_id = getattr(item, "extraction_rule_id", None)
        key_info = getattr(item, "key_info", None)
        if rule_id and key_info:
            if rule_id < 0:
                builtin_rule_ids.add(rule_id)
            else:
                rule_ids.add(rule_id)

    if not rule_ids and not builtin_rule_ids:
        return

    rules_map: dict[int, dict[str, str]] = {}

    # 加载内置规则的字段映射
    for bid in builtin_rule_ids:
        builtin = get_builtin_extraction_rule(bid)
        if builtin:
            key_to_label = {}
            for f in builtin.get("fields", []):
                k = f.get("key", "")
                label = f.get("label", "")
                if k and label:
                    key_to_label[k] = label
            rules_map[bid] = key_to_label

    # 批量加载数据库提取规则
    if rule_ids:
        result = await db.execute(
            sa_select(ExtractionRule).where(ExtractionRule.id.in_(rule_ids))
        )
        for rule in result.scalars().all():
            key_to_label = {}
            for f in (rule.fields or []):
                k = f.get("key", "")
                label = f.get("label", "")
                if k and label:
                    key_to_label[k] = label
            rules_map[rule.id] = key_to_label

    # 翻译 key_info
    for item in items:
        rule_id = getattr(item, "extraction_rule_id", None)
        key_info = getattr(item, "key_info", None)
        if not rule_id or not key_info or rule_id not in rules_map:
            continue
        mapping = rules_map[rule_id]
        needs_translate = any(k in mapping for k in key_info)
        if needs_translate:
            translated = {mapping.get(k, k): v for k, v in key_info.items()}
            item.key_info = translated
