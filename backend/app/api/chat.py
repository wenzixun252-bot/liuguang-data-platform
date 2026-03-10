""""流光"智能问答接口 — 流式 SSE + 非流式 JSON + 附件解析。"""

import io
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
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
from app.services.rag import SearchResult, hybrid_searcher

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["流光助手"])

# ── System Prompt 模板 ───────────────────────────────────

SYSTEM_PROMPT = """你是"流光"个人数据助手，帮助用户从自己的数据资产（文档、会议纪要、聊天记录等）中获取精准答案。

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
要求：
1. 提取核心意图和关键词
2. 去掉口语化表达（如"那个"、"来着"、"啥"）
3. 补充可能的同义词
4. 只输出改写后的查询文本，不要解释

用户问题：{question}
改写查询："""


async def _rewrite_query(question: str) -> str:
    """用 LLM 将口语化问题改写为精准搜索查询。"""
    # 如果问题已经很简短明确（少于 10 个字且无口语词），直接返回
    casual_markers = ["吗", "呢", "啥", "来着", "那个", "怎么", "什么时候", "有没有"]
    if len(question) < 10 and not any(m in question for m in casual_markers):
        return question

    try:
        client = _get_agent_client()
        response = await client.chat.completions.create(
            model=settings.agent_llm_model,
            messages=[{"role": "user", "content": QUERY_REWRITE_PROMPT.format(question=question)}],
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


def _build_context(results: list[SearchResult], attachment_context: str | None = None) -> str:
    """构建检索上下文文本。"""
    if not results and not attachment_context:
        return "（未检索到相关数据）"
    parts = []
    for i, r in enumerate(results, 1):
        title = r.title or "无标题"
        label = SOURCE_TABLE_LABELS.get(r.source_table, r.source_table)
        parts.append(f"[{i}] 类型: {label}\n标题: {title}\nID: {r.source_table}:{r.id}\n内容: {r.content_text[:1500]}")
    if attachment_context:
        parts.append(f"\n## 用户上传附件内容\n{attachment_context[:2000]}")
    return "\n\n".join(parts) if parts else "（未检索到相关数据）"


def _build_messages(
    question: str,
    history: list[dict],
    context: str,
) -> list[dict]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context)}]
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
    body: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """SSE 流式问答接口。"""
    visible_ids = await get_visible_owner_ids(current_user, db)

    # 查询改写：将口语化问题转为精准搜索查询
    search_query = await _rewrite_query(body.question)

    # Graph-RAG 增强：从问题提取实体，找到关联内容
    graph_source_ids = await graph_rag_enhancer.enhance_search(
        body.question, current_user.feishu_open_id, db,
    )
    # 合并 Graph-RAG 结果到 source_ids
    merged_source_ids = body.source_ids
    if graph_source_ids:
        merged_source_ids = list(set((merged_source_ids or []) + graph_source_ids))

    results = await hybrid_searcher.search(
        query_text=search_query,
        visible_ids=visible_ids,
        db=db,
        source_tables=body.source_tables,
        source_ids=merged_source_ids if merged_source_ids else None,
    )

    context = _build_context(results, body.attachment_context)
    history = [{"role": m.role, "content": m.content} for m in body.history]
    messages = _build_messages(body.question, history, context)

    source_id_list = [
        {"type": r.source_table, "id": r.id, "title": r.title or "无标题"}
        for r in results
    ]

    async def _event_generator():
        client = _get_agent_client()
        full_content = ""
        try:
            stream = await client.chat.completions.create(
                model=settings.agent_llm_model,
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta
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
            logger.error("流式问答异常: %s", e)
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
    body: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ChatResponse:
    """普通 JSON 问答接口。"""
    visible_ids = await get_visible_owner_ids(current_user, db)

    # 查询改写
    search_query = await _rewrite_query(body.question)

    # Graph-RAG 增强
    graph_source_ids = await graph_rag_enhancer.enhance_search(
        body.question, current_user.feishu_open_id, db,
    )
    merged_source_ids = body.source_ids
    if graph_source_ids:
        merged_source_ids = list(set((merged_source_ids or []) + graph_source_ids))

    results = await hybrid_searcher.search(
        query_text=search_query,
        visible_ids=visible_ids,
        db=db,
        source_tables=body.source_tables,
        source_ids=merged_source_ids if merged_source_ids else None,
    )

    context = _build_context(results, body.attachment_context)
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
