""""流光"智能问答接口 — 流式 SSE + 非流式 JSON。"""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_visible_owner_ids
from app.config import settings
from app.models.user import User
from app.schemas.chat import ChatRequest, ChatResponse
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
    "meeting": "会议",
    "chat_message": "聊天",
}


def _build_context(results: list[SearchResult]) -> str:
    """构建检索上下文文本。"""
    if not results:
        return "（未检索到相关数据）"
    parts = []
    for i, r in enumerate(results, 1):
        title = r.title or "无标题"
        label = SOURCE_TABLE_LABELS.get(r.source_table, r.source_table)
        parts.append(f"[{i}] 类型: {label}\n标题: {title}\nID: {r.source_table}:{r.id}\n内容: {r.content_text[:500]}")
    return "\n\n".join(parts)


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


# ── 流式接口 ─────────────────────────────────────────────


@router.post("/stream", summary="流式问答 (SSE)")
async def chat_stream(
    body: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """SSE 流式问答接口。"""
    visible_ids = await get_visible_owner_ids(current_user, db)

    results = await hybrid_searcher.search(
        query_text=body.question,
        visible_ids=visible_ids,
        db=db,
    )

    context = _build_context(results)
    history = [{"role": m.role, "content": m.content} for m in body.history]
    messages = _build_messages(body.question, history, context)

    source_ids = [f"{r.source_table}:{r.id}" for r in results]

    async def _event_generator():
        client = _get_agent_client()
        try:
            stream = await client.chat.completions.create(
                model=settings.agent_llm_model,
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta
                if delta.content:
                    data = json.dumps({"type": "content", "content": delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"

            data = json.dumps({"type": "sources", "sources": source_ids}, ensure_ascii=False)
            yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
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

    results = await hybrid_searcher.search(
        query_text=body.question,
        visible_ids=visible_ids,
        db=db,
    )

    context = _build_context(results)
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

    source_ids = [f"{r.source_table}:{r.id}" for r in results]

    return ChatResponse(answer=answer, sources=source_ids)
