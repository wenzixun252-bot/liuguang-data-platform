""""流光"智能问答接口 — 流式 SSE + 非流式 JSON + 附件解析。"""

import io
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.config import settings
from app.models.conversation import Conversation, ConversationMessage
from app.models.user import User
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.graph_rag import graph_rag_enhancer
from app.services.rag import SearchResult, hybrid_searcher

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["流光助手"])

# ── System Prompt 模板 ───────────────────────────────────

SYSTEM_PROMPT = """你是"流光"办公助手，基于员工的数据资产回答问题。

## 规则
1. 仅基于以下检索到的上下文回答问题，不要编造信息
2. 如果上下文中没有相关信息，明确告知"未找到相关数据"
3. 回答时引用数据来源（标注来源类型和ID）
4. 使用简洁、专业的中文回答
5. 如果涉及多条数据，请分点说明

## 检索上下文
{context}
"""

MAX_HISTORY_TURNS = 10

SOURCE_TABLE_LABELS = {
    "document": "文档",
    "communication": "沟通记录",
}


def _build_context(results: list[SearchResult], attachment_context: str | None = None) -> str:
    """构建检索上下文文本。"""
    if not results and not attachment_context:
        return "（未检索到相关数据）"
    parts = []
    for i, r in enumerate(results, 1):
        title = r.title or "无标题"
        label = SOURCE_TABLE_LABELS.get(r.source_table, r.source_table)
        parts.append(f"[{i}] 类型: {label}\n标题: {title}\nID: {r.source_table}:{r.id}\n内容: {r.content_text[:500]}")
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


def _get_agent_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.agent_llm_api_key,
        base_url=settings.agent_llm_base_url,
    )


async def _save_messages(
    db: AsyncSession,
    conversation_id: int,
    owner_id: str,
    user_content: str,
    assistant_content: str,
    source_ids: list[str],
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

    # Graph-RAG 增强：从问题提取实体，找到关联内容
    graph_source_ids = await graph_rag_enhancer.enhance_search(
        body.question, current_user.feishu_open_id, db,
    )
    # 合并 Graph-RAG 结果到 source_ids
    merged_source_ids = body.source_ids
    if graph_source_ids:
        merged_source_ids = list(set((merged_source_ids or []) + graph_source_ids))

    results = await hybrid_searcher.search(
        query_text=body.question,
        visible_ids=visible_ids,
        db=db,
        source_tables=body.source_tables,
        source_ids=merged_source_ids if merged_source_ids else None,
    )

    context = _build_context(results, body.attachment_context)
    history = [{"role": m.role, "content": m.content} for m in body.history]
    messages = _build_messages(body.question, history, context)

    source_id_list = [f"{r.source_table}:{r.id}" for r in results]

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

    # Graph-RAG 增强
    graph_source_ids = await graph_rag_enhancer.enhance_search(
        body.question, current_user.feishu_open_id, db,
    )
    merged_source_ids = body.source_ids
    if graph_source_ids:
        merged_source_ids = list(set((merged_source_ids or []) + graph_source_ids))

    results = await hybrid_searcher.search(
        query_text=body.question,
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

    source_id_list = [f"{r.source_table}:{r.id}" for r in results]

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
