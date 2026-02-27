""""流光"智能问答接口 — 流式 SSE + 非流式 JSON。"""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
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
3. 回答时引用数据来源（标注记录ID）
4. 使用简洁、专业的中文回答
5. 如果涉及多条数据，请分点说明

## 检索上下文
{context}
"""

MAX_HISTORY_TURNS = 10


def _build_context(results: list[SearchResult]) -> str:
    """构建检索上下文文本。"""
    if not results:
        return "（未检索到相关数据）"
    parts = []
    for i, r in enumerate(results, 1):
        title = r.title or "无标题"
        parts.append(f"[{i}] 标题: {title}\n记录ID: {r.feishu_record_id}\n内容: {r.content_text[:500]}")
    return "\n\n".join(parts)


def _build_messages(
    question: str,
    history: list[dict],
    context: str,
) -> list[dict]:
    """构建发送给 LLM 的完整消息列表。"""
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context)}]

    # 截断历史：保留最近 N 轮
    truncated = history[-(MAX_HISTORY_TURNS * 2):]
    messages.extend(truncated)

    messages.append({"role": "user", "content": question})
    return messages


def _get_agent_client() -> AsyncOpenAI:
    """获取流光助手 Agent LLM 客户端。"""
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
    """SSE 流式问答接口。逐 chunk 通过 Server-Sent Events 推送回答。"""
    # 1. 混合检索
    results = await hybrid_searcher.search(
        query_text=body.question,
        user_open_id=current_user.feishu_open_id,
        user_role=current_user.role,
        db=db,
    )

    # 2. 构建消息
    context = _build_context(results)
    history = [{"role": m.role, "content": m.content} for m in body.history]
    messages = _build_messages(body.question, history, context)

    source_ids = [r.feishu_record_id for r in results]

    # 3. 流式调用 LLM
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

            # 发送来源信息
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
    """普通 JSON 问答接口，返回完整回答 + 引用来源。"""
    # 1. 混合检索
    results = await hybrid_searcher.search(
        query_text=body.question,
        user_open_id=current_user.feishu_open_id,
        user_role=current_user.role,
        db=db,
    )

    # 2. 构建消息
    context = _build_context(results)
    history = [{"role": m.role, "content": m.content} for m in body.history]
    messages = _build_messages(body.question, history, context)

    # 3. 调用 LLM
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

    source_ids = [r.feishu_record_id for r in results]

    return ChatResponse(answer=answer, sources=source_ids)
