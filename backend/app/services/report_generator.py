"""报告生成服务 — 从个人知识库生成报告。"""

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, and_, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.communication import Communication
from app.models.document import Document
from app.models.report import Report, ReportTemplate
from app.models.user import User
from app.services.llm import llm_client

logger = logging.getLogger(__name__)

# 北京时间 UTC+8
_BEIJING_TZ = timezone(timedelta(hours=8))


def _to_beijing_str(dt: datetime | None) -> str:
    """将 naive UTC datetime 转换为北京时间字符串。"""
    if dt is None:
        return ""
    # 数据库存的是 UTC naive datetime，加上时区后转北京时间
    utc_dt = dt.replace(tzinfo=timezone.utc)
    beijing_dt = utc_dt.astimezone(_BEIJING_TZ)
    return beijing_dt.strftime("%m-%d %H:%M") + "(北京时间)"

REPORT_SYSTEM_PROMPT = """你是一位资深的商业分析师，擅长从零散的工作数据中提炼洞察、发现趋势。

## 写作风格
- 数据驱动：每个结论必须引用具体数据（日期、人名、事件、数字）
- 重点突出：最重要的内容放在最前面
- 言之有物：严禁使用模板套话（如"取得了显著成果"、"进展顺利"）
- 诚实客观：如果某个版块数据不足，直接写"本周期该领域无相关数据"，不要凑字数
- 使用专业简洁的中文，Markdown 格式输出

## 文档产出归属原则（严格执行）
数据中 "my_documents" 是当前用户本人拥有的文档（资产所有人 = 当前用户），这些才是用户的真实产出。
"reference_documents" 是用户归档的他人文档，仅供参考上下文，绝对不能算作用户的产出成果。
在"产出成果"、"数据分析"等统计产出数量的版块中，只统计 my_documents，不得将 reference_documents 计入。

## 标签优先原则
数据中带有 "tags" 字段的条目表示用户对其做了分类标记。这些标签反映了用户自己的关注重点。
在撰写报告时，请优先引用带有标签的数据，并在分析时体现标签所代表的主题归属。

## 时间处理规则（极其重要）
- 数据中的 "创建时间"、"修改时间" 和 "发生时间" 字段已转换为北京时间（UTC+8），请**直接使用**这些字段的时间值
- **严禁**从 content 正文内容中提取或推断时间戳，content 中的时间可能是 UTC 时区，会比北京时间早 8 小时
- 报告中引用的所有日期和时间，一律以 "创建时间"、"修改时间" 或 "发生时间" 字段为准
- 文档的 "创建时间" 是飞书文档的首次创建时间，"修改时间" 是飞书文档的最后修改时间，两者都来自飞书 API，与上传时间无关
- 如果 "创建时间" 或 "修改时间" 为空字符串，说明该文档缺少对应的飞书时间信息，可忽略该字段

## 业务域分析
如果数据中包含 "business_domain_summary" 字段，这是用户知识图谱的业务域分析结果。
请利用这些业务域维度来组织和分析数据，例如按域维度归纳工作重点、识别跨域协作等。"""

# 预设系统模板
SYSTEM_TEMPLATES = [
    {
        "name": "周报",
        "description": "自动汇总本周工作，生成标准周报",
        "prompt_template": """请根据以下数据，为用户生成一份周报。

## 数据内容
{data}

## 输出结构
### 本周工作总结
（用 3-5 个要点汇总本周最重要的工作成果，每个要点引用具体事件和日期）

### 重点会议与决策
（列出关键会议的主题、参与人、核心决策和后续行动，跳过无实质内容的会议）

### 产出成果
（仅列出 my_documents 中的文档作为产出物，包括文档名称、方案版本、交付件等。reference_documents 是归档的他人文档，不算产出）

### 下周计划
（基于当前未完成事项和会议决策，推断下周 2-3 个重点方向）

## 写作要求
- 每个结论必须引用具体数据（日期、人名、事件）
- 如果某版块数据不足，写"本周期无相关数据"，不要编造内容
- 最重要的 3 件事放在总结最前面
{extra_instructions}
""",
        "output_structure": {
            "sections": ["本周工作总结", "重点会议与决策", "产出成果", "下周计划"]
        },
    },
    {
        "name": "月报",
        "description": "自动汇总月度工作，生成月度报告",
        "prompt_template": """请根据以下数据，为用户生成一份月度报告。

## 数据内容
{data}

## 输出结构
### 月度目标回顾
（从数据中提炼本月实际完成的主要事项，用事实说明完成情况）

### 重点项目进展
（按项目分组，列出每个项目的关键里程碑、参与人、当前状态）

### 关键会议决策
（仅列出有实质决策的会议，说明决策内容和影响范围）

### 数据分析
（统计本月文档产出数量时仅统计 my_documents，不得将 reference_documents 计入产出。同时统计会议频次等可量化指标，发现趋势）

## 写作要求
- 每个结论必须引用具体数据（日期、人名、事件）
- 如果某版块数据不足，写"本周期无相关数据"，不要编造内容
- 最重要的 3 件事放在总结最前面
{extra_instructions}
""",
        "output_structure": {
            "sections": ["月度目标回顾", "重点项目进展", "关键会议决策", "数据分析"]
        },
    },
    {
        "name": "项目总结",
        "description": "自动汇总项目相关数据，生成项目总结报告",
        "prompt_template": """请根据以下数据，为用户生成一份项目总结报告。

## 数据内容
{data}

## 输出结构
### 项目背景
（从数据中提取项目名称、启动时间、核心目标）

### 完成情况
（按时间线列出各阶段的关键成果和交付件，引用具体文档和会议）

### 经验教训
（从会议讨论和沟通记录中提炼实际遇到的问题和解决方案）

### 后续计划
（基于未完成的行动项和最近的会议决策，列出后续安排）

## 写作要求
- 每个结论必须引用具体数据（日期、人名、事件）
- 如果某版块数据不足，写"本周期无相关数据"，不要编造内容
- 最重要的 3 件事放在总结最前面
{extra_instructions}
""",
        "output_structure": {
            "sections": ["项目背景", "完成情况", "经验教训", "后续计划"]
        },
    },
]


async def ensure_system_templates(db: AsyncSession) -> None:
    """确保系统预设模板存在。"""
    result = await db.execute(
        select(func.count()).select_from(ReportTemplate).where(
            ReportTemplate.template_type == "system"
        )
    )
    count = result.scalar()
    if count and count >= len(SYSTEM_TEMPLATES):
        return

    for tpl in SYSTEM_TEMPLATES:
        existing = await db.execute(
            select(ReportTemplate).where(
                and_(
                    ReportTemplate.name == tpl["name"],
                    ReportTemplate.template_type == "system",
                )
            )
        )
        if existing.scalar_one_or_none():
            continue

        db.add(ReportTemplate(
            name=tpl["name"],
            template_type="system",
            prompt_template=tpl["prompt_template"],
            output_structure=tpl["output_structure"],
            description=tpl["description"],
        ))

    await db.commit()


async def _query_content_tags(
    db: AsyncSession,
    content_type: str,
    content_ids: list[int],
) -> dict[int, list[str]]:
    """批量查询内容关联的标签名称。返回 {content_id: [tag_name, ...]}。"""
    if not content_ids:
        return {}
    from app.models.tag import ContentTag, TagDefinition
    result = await db.execute(
        select(ContentTag.content_id, TagDefinition.name)
        .join(TagDefinition, TagDefinition.id == ContentTag.tag_id)
        .where(
            and_(
                ContentTag.content_type == content_type,
                ContentTag.content_id.in_(content_ids),
            )
        )
    )
    tag_map: dict[int, list[str]] = {}
    for row in result.all():
        tag_map.setdefault(row[0], []).append(row[1])
    return tag_map


def _doc_effective_time(doc_model=None):
    """构建文档的有效时间表达式（用于 SQL 查询过滤）。

    飞书文档：优先用 feishu_updated_at（最后修改时间），其次 feishu_created_at，最后 created_at
    本地文档：用 created_at（上传时间）
    """
    D = doc_model or Document
    return case(
        (D.source_type == "cloud",
         func.coalesce(D.feishu_updated_at, D.feishu_created_at, D.created_at)),
        else_=D.created_at,
    )


def _comm_effective_time(comm_model=None):
    """构建沟通记录的有效时间表达式。

    会议：用 comm_time（会议时间），回退到 created_at
    聊天：用 comm_time（发送时间），回退到 created_at
    """
    C = comm_model or Communication
    return func.coalesce(C.comm_time, C.created_at)


async def gather_data(
    db: AsyncSession,
    owner_id: str,
    time_start: datetime,
    time_end: datetime,
    data_sources: list[str],
) -> dict:
    """从三表按时间范围收集用户数据，附带标签信息。

    时间过滤逻辑：
    - 飞书文档：使用创建时间(feishu_created_at)和修改时间(feishu_updated_at)
    - 本地文档：无飞书时间，字段为空
    - 会议：参考会议时间(comm_time)
    - 聊天：参考发送时间(comm_time)
    """
    # 三表列为 TIMESTAMP WITHOUT TIME ZONE（存的是 UTC），需要先转 UTC 再去 tzinfo
    if time_start.tzinfo is not None:
        time_start = time_start.astimezone(timezone.utc).replace(tzinfo=None)
    if time_end.tzinfo is not None:
        time_end = time_end.astimezone(timezone.utc).replace(tzinfo=None)

    data: dict = {"my_documents": [], "reference_documents": [], "communications": []}

    # 查询当前用户姓名，用于区分"我的产出"和"归档的他人文档"
    user_result = await db.execute(
        select(User.name).where(User.feishu_open_id == owner_id)
    )
    current_user_name = user_result.scalar_one_or_none() or ""

    doc_eff_time = _doc_effective_time()
    comm_eff_time = _comm_effective_time()

    if "document" in data_sources:
        result = await db.execute(
            select(Document).where(
                and_(
                    Document.owner_id == owner_id,
                    doc_eff_time >= time_start,
                    doc_eff_time <= time_end,
                )
            ).order_by(doc_eff_time.desc()).limit(50)
        )
        docs = result.scalars().all()
        doc_tags = await _query_content_tags(db, "document", [d.id for d in docs])

        for d in docs:
            doc_item = {
                "title": d.title,
                "content": d.content_text[:1500],
                "创建时间": _to_beijing_str(d.feishu_created_at),
                "修改时间": _to_beijing_str(d.feishu_updated_at),
                "tags": doc_tags.get(d.id, []),
                "asset_owner": d.uploader_name or "",
            }
            # 严格按资产所有人区分：只有 uploader_name 匹配当前用户才算"我的产出"
            if d.uploader_name and d.uploader_name == current_user_name:
                data["my_documents"].append(doc_item)
            else:
                data["reference_documents"].append(doc_item)

    if "communication" in data_sources:
        result = await db.execute(
            select(Communication).where(
                and_(
                    Communication.owner_id == owner_id,
                    comm_eff_time >= time_start,
                    comm_eff_time <= time_end,
                )
            ).order_by(comm_eff_time.desc()).limit(100)
        )
        comms = result.scalars().all()
        comm_tags = await _query_content_tags(db, "communication", [c.id for c in comms])
        data["communications"] = [
            {
                "type": c.comm_type,
                "title": c.title,
                "发生时间": _to_beijing_str(c.comm_time or c.created_at),
                "initiator": c.initiator,
                "conclusions": c.conclusions,
                "content": c.content_text[:1500],
                "tags": comm_tags.get(c.id, []),
            }
            for c in comms
        ]

    # 注入业务域分析摘要（来自知识图谱社群检测结果）
    try:
        from app.models.kg_analysis_result import KGAnalysisResult
        analysis_result = await db.execute(
            select(KGAnalysisResult)
            .where(KGAnalysisResult.owner_id == owner_id)
            .order_by(KGAnalysisResult.generated_at.desc())
            .limit(1)
        )
        analysis = analysis_result.scalar_one_or_none()
        if analysis and analysis.communities:
            domain_lines = [
                f"- {c['domain_label']}：{c['member_count']}个实体，核心：{'、'.join(c.get('top_entities', [])[:5])}"
                for c in analysis.communities if c.get("domain_label")
            ]
            if domain_lines:
                data["business_domain_summary"] = "\n".join(domain_lines)
    except Exception as e:
        logger.warning("查询业务域分析失败，跳过: %s", e)

    return data


async def _build_reader_context(db: AsyncSession, owner_id: str, reader_ids: list[str]) -> str:
    """构建阅读者画像上下文，注入到 LLM prompt 中。"""
    if not reader_ids:
        return ""

    from app.models.knowledge_graph import KGEntity, KGRelation
    from app.models.leadership_insight import LeadershipInsight

    reader_profiles = []
    for reader_name in reader_ids:
        profile_parts = []

        # 从知识图谱查找此人的关联
        entity_result = await db.execute(
            select(KGEntity).where(and_(
                KGEntity.owner_id == owner_id,
                KGEntity.entity_type == "person",
                KGEntity.name == reader_name,
            )).limit(1)
        )
        entity = entity_result.scalar_one_or_none()

        if entity:
            # 获取其关联的项目和话题
            from sqlalchemy import or_
            rel_result = await db.execute(
                select(KGRelation).where(and_(
                    KGRelation.owner_id == owner_id,
                    or_(
                        KGRelation.source_entity_id == entity.id,
                        KGRelation.target_entity_id == entity.id,
                    ),
                )).limit(20)
            )
            rels = rel_result.scalars().all()
            related_ids = set()
            for r in rels:
                related_ids.add(r.source_entity_id)
                related_ids.add(r.target_entity_id)
            related_ids.discard(entity.id)

            if related_ids:
                re_result = await db.execute(
                    select(KGEntity).where(KGEntity.id.in_(related_ids))
                )
                for re in re_result.scalars().all():
                    if re.entity_type == "item":
                        profile_parts.append(f"关注事项: {re.name}")

        # 查找领导力洞察
        insight_result = await db.execute(
            select(LeadershipInsight)
            .where(LeadershipInsight.target_user_name == reader_name)
            .order_by(LeadershipInsight.generated_at.desc())
            .limit(1)
        )
        insight = insight_result.scalar_one_or_none()
        if insight and insight.report_markdown:
            profile_parts.append(f"风格特点: {insight.report_markdown[:200]}")

        if profile_parts:
            reader_profiles.append(f"- {reader_name}: {'; '.join(profile_parts)}")
        else:
            reader_profiles.append(f"- {reader_name}")

    return "\n\n## 报告阅读者画像\n以下是本报告的目标阅读者信息，请根据他们的关注点和偏好来调整报告内容的侧重：\n" + "\n".join(reader_profiles) + "\n"


async def generate_report(
    db: AsyncSession,
    owner_id: str,
    template_id: int,
    title: str,
    time_start: datetime,
    time_end: datetime,
    data_sources: list[str],
    extra_instructions: str | None = None,
    target_reader_ids: list[str] | None = None,
) -> Report:
    """生成报告（非流式）。"""
    if time_start.tzinfo is not None:
        time_start = time_start.astimezone(timezone.utc).replace(tzinfo=None)
    if time_end.tzinfo is not None:
        time_end = time_end.astimezone(timezone.utc).replace(tzinfo=None)

    template = await db.get(ReportTemplate, template_id)
    if not template:
        raise ValueError("模板不存在")

    data = await gather_data(db, owner_id, time_start, time_end, data_sources)
    reader_context = await _build_reader_context(db, owner_id, target_reader_ids or [])

    data_text = json.dumps(data, ensure_ascii=False, indent=2)
    prompt = template.prompt_template.format(
        data=data_text[:8000],
        extra_instructions=(extra_instructions or "") + reader_context,
    )

    report = Report(
        owner_id=owner_id,
        template_id=template_id,
        title=title,
        status="generating",
        time_range_start=time_start,
        time_range_end=time_end,
        target_readers=target_reader_ids or [],
        data_sources_used={
            "sources": data_sources,
            "counts": {
                "my_documents": len(data["my_documents"]),
                "reference_documents": len(data["reference_documents"]),
                "communications": len(data["communications"]),
            },
        },
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    try:
        response = await llm_client.chat_client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[
                {"role": "system", "content": REPORT_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )
        content = response.choices[0].message.content
        report.content_markdown = content
        report.status = "completed"
    except Exception as e:
        logger.error("报告生成失败: %s", e)
        report.status = "failed"
        report.content_markdown = f"生成失败: {e}"

    await db.commit()
    await db.refresh(report)
    return report


async def _background_generate(
    report_id: int,
    owner_id: str,
    template_prompt: str,
    time_start: datetime,
    time_end: datetime,
    data_sources: list[str],
    extra_instructions: str | None,
    target_reader_ids: list[str] | None,
) -> None:
    """后台异步生成报告（不阻塞前端请求）。"""
    from app.database import async_session

    async with async_session() as db:
        try:
            report = await db.get(Report, report_id)
            if not report:
                return

            data = await gather_data(db, owner_id, time_start, time_end, data_sources)
            reader_context = await _build_reader_context(db, owner_id, target_reader_ids or [])

            data_text = json.dumps(data, ensure_ascii=False, indent=2)
            prompt = template_prompt.format(
                data=data_text[:8000],
                extra_instructions=(extra_instructions or "") + reader_context,
            )

            # 更新数据源统计
            report.data_sources_used = {
                "sources": data_sources,
                "counts": {
                    "my_documents": len(data["my_documents"]),
                "reference_documents": len(data["reference_documents"]),
                    "communications": len(data["communications"]),
                },
            }
            await db.commit()

            response = await llm_client.chat_client.chat.completions.create(
                model=settings.agent_llm_model,
                messages=[
                    {"role": "system", "content": REPORT_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
            )
            content = response.choices[0].message.content
            report.content_markdown = content
            report.status = "completed"
        except Exception as e:
            logger.error("后台报告生成失败 (id=%s): %s", report_id, e)
            report = await db.get(Report, report_id)
            if report:
                report.status = "failed"
                report.content_markdown = f"生成失败: {e}"
        await db.commit()


async def start_report_background(
    db: AsyncSession,
    owner_id: str,
    template_id: int,
    title: str,
    time_start: datetime,
    time_end: datetime,
    data_sources: list[str],
    extra_instructions: str | None = None,
    target_reader_ids: list[str] | None = None,
) -> Report:
    """创建报告记录，然后在后台异步生成（立即返回报告ID）。"""
    if time_start.tzinfo is not None:
        time_start = time_start.replace(tzinfo=None)
    if time_end.tzinfo is not None:
        time_end = time_end.replace(tzinfo=None)

    template = await db.get(ReportTemplate, template_id)
    if not template:
        raise ValueError("模板不存在")

    report = Report(
        owner_id=owner_id,
        template_id=template_id,
        title=title,
        status="generating",
        time_range_start=time_start,
        time_range_end=time_end,
        target_readers=target_reader_ids or [],
        data_sources_used={"sources": data_sources, "counts": {}},
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    # 在后台事件循环中启动生成任务
    asyncio.create_task(_background_generate(
        report_id=report.id,
        owner_id=owner_id,
        template_prompt=template.prompt_template,
        time_start=time_start,
        time_end=time_end,
        data_sources=data_sources,
        extra_instructions=extra_instructions,
        target_reader_ids=target_reader_ids,
    ))

    return report


async def generate_report_stream(
    db: AsyncSession,
    owner_id: str,
    template_id: int,
    title: str,
    time_start: datetime,
    time_end: datetime,
    data_sources: list[str],
    extra_instructions: str | None = None,
    target_reader_ids: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """流式生成报告（SSE）— 保留兼容。"""
    if time_start.tzinfo is not None:
        time_start = time_start.astimezone(timezone.utc).replace(tzinfo=None)
    if time_end.tzinfo is not None:
        time_end = time_end.astimezone(timezone.utc).replace(tzinfo=None)

    template = await db.get(ReportTemplate, template_id)
    if not template:
        yield json.dumps({"type": "error", "content": "模板不存在"}, ensure_ascii=False)
        return

    data = await gather_data(db, owner_id, time_start, time_end, data_sources)
    reader_context = await _build_reader_context(db, owner_id, target_reader_ids or [])

    data_text = json.dumps(data, ensure_ascii=False, indent=2)
    prompt = template.prompt_template.format(
        data=data_text[:8000],
        extra_instructions=(extra_instructions or "") + reader_context,
    )

    report = Report(
        owner_id=owner_id,
        template_id=template_id,
        title=title,
        status="generating",
        time_range_start=time_start,
        time_range_end=time_end,
        target_readers=target_reader_ids or [],
        data_sources_used={
            "sources": data_sources,
            "counts": {
                "my_documents": len(data["my_documents"]),
                "reference_documents": len(data["reference_documents"]),
                "communications": len(data["communications"]),
            },
        },
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    yield json.dumps({"type": "report_id", "id": report.id}, ensure_ascii=False)

    full_content = []
    try:
        from app.services.llm import create_openai_client
        client = create_openai_client(
            api_key=settings.agent_llm_api_key,
            base_url=settings.agent_llm_base_url,
            timeout=120.0,
        )
        stream = await client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[
                {"role": "system", "content": REPORT_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            stream=True,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                full_content.append(delta.content)
                yield json.dumps({"type": "content", "content": delta.content}, ensure_ascii=False)

        report.content_markdown = "".join(full_content)
        report.status = "completed"
        await db.commit()

        yield json.dumps({"type": "done", "report_id": report.id}, ensure_ascii=False)
    except Exception as e:
        logger.error("流式报告生成失败: %s", e)
        report.status = "failed"
        await db.commit()
        yield json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False)
