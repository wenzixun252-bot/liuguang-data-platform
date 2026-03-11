""""流光"智能问答接口 — 流式 SSE + 非流式 JSON + 附件解析。"""

import asyncio
import io
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.config import settings
from app.services.llm import create_openai_client
from app.models.conversation import Conversation, ConversationMessage
from app.models.user import User
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.graph_rag import graph_rag_enhancer
from app.services.rag import MatchedTag, SearchResult, format_key_info, hybrid_searcher, match_tags_from_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["流光助手"])

# ── System Prompt 模板 ───────────────────────────────────

SYSTEM_PROMPT = """你是"流光"个人数据助手，帮助用户从自己的数据资产（文档、会议纪要、聊天记录等）中获取精准答案。

## 当前时间
今天是 {today}（{weekday}）。请根据此日期理解用户提到的"最近"、"本周"、"上周"、"这个月"等时间表达。

## 回答规则
1. **必须基于检索上下文回答**，严禁编造信息
2. **强制引用来源**：每个关键信息点后标注来源编号，格式为 [来源编号]
   例如："项目计划已在周三确认 [1]，预算审批通过 [3]"
3. 如果上下文不足以回答，明确说"我在你的数据中未找到相关信息"，并建议用户换个关键词或检查数据是否已同步
4. 回答要**具体**：引用具体的日期、人名、数字、结论，不要泛泛而谈
5. 多条数据时，按时间或重要性分点归纳，不要简单罗列原文
6. 对于会议纪要类内容，重点提取决策结论和行动项

## 检索上下文
{context}
"""

MAX_HISTORY_TURNS = 10

SOURCE_TABLE_LABELS = {
    "document": "文档",
    "communication": "沟通记录",
}


QUERY_REWRITE_PROMPT = """请将用户的口语化问题改写为更适合搜索的关键词查询。
今天是 {today}（{weekday}）。
要求：
1. 提取核心意图和关键词
2. 去掉口语化表达（如"那个"、"来着"、"啥"）
3. 补充可能的同义词
4. 如果用户提到时间相关词（如"最近"、"本周"、"上周"），请换算成具体日期范围
5. 只输出改写后的查询文本，不要解释

用户问题：{question}
改写查询："""


async def _rewrite_query(question: str) -> str:
    """用 LLM 将口语化问题改写为精准搜索查询。"""
    # 如果问题已经很简短明确（少于 10 个字且无口语词和时间词），直接返回
    casual_markers = ["吗", "呢", "啥", "来着", "那个", "怎么", "什么时候", "有没有"]
    time_markers = ["最近", "本周", "上周", "这周", "这个月", "上个月", "今天", "昨天", "前天"]
    if len(question) < 10 and not any(m in question for m in casual_markers) and not any(m in question for m in time_markers):
        return question

    try:
        from datetime import date
        today = date.today()
        weekday = _WEEKDAY_CN[today.weekday()]
        # 查询改写用快模型，不需要强模型
        from app.services.llm import llm_client
        response = await llm_client.chat_client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": QUERY_REWRITE_PROMPT.format(
                question=question, today=today.isoformat(), weekday=weekday,
            )}],
            temperature=0.0,
            max_tokens=100,
        )
        rewritten = response.choices[0].message.content.strip()
        if rewritten:
            logger.info("查询改写: '%s' -> '%s'", question, rewritten)
            return rewritten
    except Exception as e:
        logger.warning("查询改写失败，使用原始问题: %s", e)

    return question


def _build_context(
    results: list[SearchResult],
    attachment_context: str | None = None,
    matched_tags: list[MatchedTag] | None = None,
    domain_labels: list[str] | None = None,
) -> str:
    """构建检索上下文文本。"""
    if not results and not attachment_context:
        return "（未检索到相关数据）"
    parts = []

    # 域背景提示：告知 LLM 本次检索涉及的业务领域
    if domain_labels:
        parts.append(
            f"## 涉及业务领域\n"
            f"本次检索涉及以下工作领域：{'、'.join(domain_labels)}。"
            f"请结合业务领域背景理解数据。"
        )

    # 如果有命中标签，在上下文顶部说明
    if matched_tags:
        tag_names = "、".join(f"「{t.name}」" for t in matched_tags)
        parts.append(
            f"## 用户关注标签\n"
            f"用户的提问命中了以下自定义标签: {tag_names}\n"
            f"标有 ★ 的来源与这些标签直接关联，请优先基于这些来源进行回答。"
        )

    for i, r in enumerate(results, 1):
        title = r.title or "无标题"
        label = SOURCE_TABLE_LABELS.get(r.source_table, r.source_table)
        tag_marker = ""
        if r.matched_tags:
            tag_marker = f" ★ 关联标签: {', '.join(r.matched_tags)}"
        key_info_text = format_key_info(r.key_info)
        parts.append(f"[{i}] 类型: {label}{tag_marker}\n标题: {title}\nID: {r.source_table}:{r.id}\n内容: {r.content_text[:1500]}{key_info_text}")
    if attachment_context:
        parts.append(f"\n## 用户上传附件内容\n{attachment_context[:2000]}")
    return "\n\n".join(parts) if parts else "（未检索到相关数据）"


_WEEKDAY_CN = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]


def _build_messages(
    question: str,
    history: list[dict],
    context: str,
) -> list[dict]:
    from datetime import date
    today = date.today()
    weekday = _WEEKDAY_CN[today.weekday()]
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(
        context=context, today=today.isoformat(), weekday=weekday,
    )}]
    truncated = history[-(MAX_HISTORY_TURNS * 2):]
    messages.extend(truncated)
    messages.append({"role": "user", "content": question})
    return messages


def _get_agent_client():
    return create_openai_client(
        api_key=settings.agent_llm_api_key,
        base_url=settings.agent_llm_base_url,
        timeout=120.0,
    )


async def _save_messages(
    db: AsyncSession,
    conversation_id: int,
    owner_id: str,
    user_content: str,
    assistant_content: str,
    source_ids: list,
    attachments: list | None = None,
):
    """保存用户和助手消息到 conversation_messages 表。"""
    # 验证会话属于当前用户
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.owner_id == owner_id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        return

    db.add(ConversationMessage(
        conversation_id=conversation_id,
        role="user",
        content=user_content,
        attachments=attachments,
    ))
    db.add(ConversationMessage(
        conversation_id=conversation_id,
        role="assistant",
        content=assistant_content,
        sources=source_ids,
    ))
    await db.commit()


# ── 流式接口 ─────────────────────────────────────────────


@router.post("/stream", summary="流式问答 (SSE)")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """SSE 流式问答接口。"""
    import time as _time
    _t0 = _time.time()
    _timing_lines = []

    visible_ids = await get_visible_owner_ids(current_user, db, request)
    _timing_lines.append(f"[TIMING] get_visible_ids: {_time.time() - _t0:.1f}s")

    # 查询改写 + Graph-RAG 实体提取 + 标签匹配 并行执行，节省等待时间
    _t1 = _time.time()
    search_query_task = asyncio.create_task(_rewrite_query(body.question))
    graph_task = asyncio.create_task(
        graph_rag_enhancer.enhance_search(body.question, current_user.feishu_open_id, db)
    )
    tag_task = asyncio.create_task(
        match_tags_from_query(body.question, current_user.feishu_open_id, db)
    )
    search_query, graph_result, matched_tags = await asyncio.gather(
        search_query_task, graph_task, tag_task,
    )
    graph_source_ids, domain_labels = graph_result
    _timing_lines.append(
        f"[TIMING] rewrite+graph_rag+tag_match: {_time.time() - _t1:.1f}s "
        f"(query='{search_query[:50]}', tags={[t.name for t in matched_tags]}, domains={domain_labels})"
    )

    # 合并 Graph-RAG 结果到 source_ids
    merged_source_ids = body.source_ids
    if graph_source_ids:
        merged_source_ids = list(set((merged_source_ids or []) + graph_source_ids))

    # 提取命中标签 ID 用于 RAG 加权
    boost_tag_ids = [t.id for t in matched_tags] if matched_tags else None

    _t2 = _time.time()
    results = await hybrid_searcher.search(
        query_text=search_query,
        visible_ids=visible_ids,
        db=db,
        source_tables=body.source_tables,
        source_ids=merged_source_ids if merged_source_ids else None,
        boost_tag_ids=boost_tag_ids,
    )
    _timing_lines.append(f"[TIMING] hybrid_search: {_time.time() - _t2:.1f}s ({len(results)} results)")

    context = _build_context(results, body.attachment_context, matched_tags, domain_labels)
    history = [{"role": m.role, "content": m.content} for m in body.history]
    messages = _build_messages(body.question, history, context)
    _timing_lines.append(f"[TIMING] total pre-stream: {_time.time() - _t0:.1f}s")
    for _line in _timing_lines:
        logger.info(_line)

    source_id_list = [
        {"type": r.source_table, "id": r.id, "title": r.title or "无标题"}
        for r in results
    ]

    async def _event_generator():
        import traceback as _tb
        client = _get_agent_client()
        full_content = ""
        try:
            stream = await client.chat.completions.create(
                model=settings.agent_llm_model,
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                choices = chunk.choices
                if not choices:
                    continue
                delta = choices[0].delta
                if not delta:
                    continue
                # 思考过程（reasoning_content）
                if delta.reasoning_content:
                    data = json.dumps({"type": "reasoning", "content": delta.reasoning_content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                # 正式回答（content）
                if delta.content:
                    full_content += delta.content
                    data = json.dumps({"type": "content", "content": delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"

            data = json.dumps({"type": "sources", "sources": source_id_list}, ensure_ascii=False)
            yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"

            # 流式完成后保存消息
            if body.conversation_id and full_content:
                try:
                    await _save_messages(
                        db, body.conversation_id, current_user.feishu_open_id,
                        body.question, full_content, source_id_list,
                    )
                except Exception as e:
                    logger.warning("保存对话消息失败: %s", e)
        except Exception as e:
            err_detail = _tb.format_exc()
            logger.error("流式问答异常: %s\n%s", e, err_detail)
            data = json.dumps({"type": "error", "content": "生成回答时出错，请稍后重试"}, ensure_ascii=False)
            yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── 非流式接口 ───────────────────────────────────────────


@router.post("/ask", response_model=ChatResponse, summary="非流式问答 (JSON)")
async def chat_ask(
    request: Request,
    body: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ChatResponse:
    """普通 JSON 问答接口。"""
    visible_ids = await get_visible_owner_ids(current_user, db, request)

    # 查询改写 + Graph-RAG + 标签匹配 并行
    search_query, graph_result, matched_tags = await asyncio.gather(
        _rewrite_query(body.question),
        graph_rag_enhancer.enhance_search(body.question, current_user.feishu_open_id, db),
        match_tags_from_query(body.question, current_user.feishu_open_id, db),
    )
    graph_source_ids, domain_labels = graph_result
    merged_source_ids = body.source_ids
    if graph_source_ids:
        merged_source_ids = list(set((merged_source_ids or []) + graph_source_ids))

    boost_tag_ids = [t.id for t in matched_tags] if matched_tags else None

    results = await hybrid_searcher.search(
        query_text=search_query,
        visible_ids=visible_ids,
        db=db,
        source_tables=body.source_tables,
        source_ids=merged_source_ids if merged_source_ids else None,
        boost_tag_ids=boost_tag_ids,
    )

    context = _build_context(results, body.attachment_context, matched_tags, domain_labels)
    history = [{"role": m.role, "content": m.content} for m in body.history]
    messages = _build_messages(body.question, history, context)

    client = _get_agent_client()
    try:
        response = await client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=messages,
        )
        answer = response.choices[0].message.content
    except Exception as e:
        logger.error("问答异常: %s", e)
        answer = "生成回答时出错，请稍后重试"

    source_id_list = [
        {"type": r.source_table, "id": r.id, "title": r.title or "无标题"}
        for r in results
    ]

    # 保存消息
    if body.conversation_id and answer:
        try:
            await _save_messages(
                db, body.conversation_id, current_user.feishu_open_id,
                body.question, answer, source_id_list,
            )
        except Exception as e:
            logger.warning("保存对话消息失败: %s", e)

    return ChatResponse(answer=answer, sources=source_id_list)


# ── 附件解析 ─────────────────────────────────────────────


def _extract_text_from_pdf(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_text_from_docx(data: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs)


@router.post("/parse-attachment", summary="解析附件文本")
async def parse_attachment(
    file: Annotated[UploadFile, File()],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """解析上传文件，提取文本内容。支持 PDF、Word、TXT。不持久化。"""
    if not file.filename:
        raise HTTPException(400, "缺少文件名")

    data = await file.read()
    filename = file.filename.lower()

    try:
        if filename.endswith(".pdf"):
            content_text = _extract_text_from_pdf(data)
        elif filename.endswith((".docx", ".doc")):
            content_text = _extract_text_from_docx(data)
        elif filename.endswith((".txt", ".md", ".csv")):
            content_text = data.decode("utf-8", errors="replace")
        else:
            raise HTTPException(400, f"不支持的文件格式: {file.filename}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("解析附件失败: %s", e)
        raise HTTPException(400, f"文件解析失败: {e}")

    return {
        "filename": file.filename,
        "content_text": content_text,
        "char_count": len(content_text),
    }
