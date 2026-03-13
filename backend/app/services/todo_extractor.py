"""待办事项提取服务 — 从会议和聊天消息中AI提取待办。"""

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.communication import Communication
from app.models.todo_item import TodoItem
from app.services.llm import llm_client

logger = logging.getLogger(__name__)

# LLM 并发控制：最多同时 5 个请求，避免打爆 API
_LLM_SEMAPHORE = asyncio.Semaphore(5)

EXTRACT_TODO_PROMPT = """你是一个待办事项提取专家。当前用户姓名为「{user_name}」。
请从以下内容中提取需要「{user_name}」去完成的待办事项。

## 内容
{content}

## 判断规则
1. **聊天消息中的请求/委托**：如果别人发消息让「{user_name}」做某事（如"帮我看下XX"、"请你这边帮走一下流程"、"你确认下XX"、"你跟进下XX"），这就是分配给「{user_name}」的待办
2. **会议纪要中的任务分配**：如"{user_name}负责XX"、"@{user_name} 请完成XX"
3. 如果用户名的一部分出现在文本中（如全名为"文梓旬"而消息中写"梓旬"），同样视为指向该用户
4. 如果文本中某个待办没有指定负责人，但「{user_name}」是发言者或会议组织者，则视为分配给自己
5. 分配给其他人的待办，**完全忽略**
6. 纯闲聊、纯提问（没有要求行动的）、泛泛而谈的计划（如"大家注意XX"）**不算待办**
7. 为每个待办设置合理的优先级 (low/medium/high)：有明确截止时间或"尽快"等字眼设为 high
8. 如果能推断截止日期，请设置（ISO格式，如 "2026-03-10"）
9. 如果没有任何属于「{user_name}」的待办，返回空数组 []

## 输出格式（严格 JSON 数组，不要输出任何解释文字）
[{{"title": "待办标题", "description": "详细描述", "priority": "medium", "due_date": null}}]
"""


async def extract_todos_from_communications(
    db: AsyncSession,
    owner_id: str,
    user_name: str,
    days: int = 2,
) -> list[dict]:
    """从沟通记录（会议 + 会话）中提取待办，只提取分配给当前用户的。"""
    since = datetime.utcnow() - timedelta(days=days)

    # 按会议时间/发送时间过滤，而不是入库时间
    from sqlalchemy import func
    eff_time = func.coalesce(Communication.comm_time, Communication.created_at)

    result = await db.execute(
        select(Communication).where(
            and_(
                Communication.owner_id == owner_id,
                eff_time >= since,
            )
        ).order_by(Communication.comm_time.desc().nullslast()).limit(200)
    )
    comms = result.scalars().all()

    logger.info("待办提取: owner=%s, days=%d, since=%s, 找到 %d 条沟通记录",
                owner_id, days, since.isoformat(), len(comms))

    if not comms:
        logger.info("待办提取: 无沟通记录，跳过")
        return []

    # 查询已提取过待办的 communication ids，跳过已处理的记录
    # 注意：已驳回(dismissed)的待办不算"已处理"，允许重新提取
    existing_source_result = await db.execute(
        select(TodoItem.source_id).where(
            and_(
                TodoItem.owner_id == owner_id,
                TodoItem.source_type == "communication",
                TodoItem.source_id.isnot(None),
                TodoItem.status != "dismissed",
            )
        )
    )
    processed_source_ids = {r for r in existing_source_result.scalars().all()}
    logger.info("待办提取: 已处理的source_id数=%d, 跳过这些沟通记录", len(processed_source_ids))

    todos = []
    skipped_processed = 0
    skipped_no_content = 0

    # 第一步：从 action_items 直接提取（无需 LLM，很快）
    llm_comms = []  # 收集需要 LLM 处理的记录
    for comm in comms:
        if comm.id in processed_source_ids:
            skipped_processed += 1
            continue
        # 会议类：从 action_items JSONB 直接提取，按 assignee 过滤
        if comm.comm_type in ("meeting", "recording") and comm.action_items:
            for item in comm.action_items:
                assignee = item.get("assignee") or ""
                # 只保留分配给当前用户的，或未指定负责人但用户是组织者的
                is_mine = user_name and user_name in assignee
                is_organizer_unassigned = (
                    not assignee and comm.initiator and user_name in comm.initiator
                )
                if not is_mine and not is_organizer_unassigned:
                    continue
                task_text = item.get("task") or item.get("title") or ""
                if task_text:
                    todos.append({
                        "title": task_text[:512],
                        "description": item.get("description"),
                        "priority": "medium",
                        "due_date": item.get("deadline"),
                        "source_type": "communication",
                        "source_id": comm.id,
                        "source_text": task_text,
                    })

        # 收集需要 LLM 提取的记录（稍后按会话分组处理）
        if comm.content_text and len(comm.content_text.strip()) > 0:
            llm_comms.append(comm)

    # 第二步：按会话（chat_id / 单条会议）分组，给 LLM 更完整的上下文
    from collections import defaultdict
    grouped: dict[str, list] = defaultdict(list)
    for comm in llm_comms:
        # 同一会话的消息合并处理；无 chat_id 的按单条处理
        group_key = comm.chat_id or f"_single_{comm.id}"
        grouped[group_key].append(comm)

    # 最多处理 20 组，避免总耗时超过 nginx 代理超时
    group_items = list(grouped.items())
    if len(group_items) > 20:
        logger.info("待办提取: LLM 分组 %d 个，截取最新 20 组处理", len(group_items))
        group_items = group_items[:20]

    if group_items:
        logger.info("待办提取: 需要 LLM 处理 %d 组（共 %d 条记录），并发提取中...",
                     len(group_items), sum(len(v) for _, v in group_items))

        async def _extract_group(group_key: str, group_comms: list):
            """将同一会话的消息合并后发给 LLM，并带上发送者信息。"""
            async with _LLM_SEMAPHORE:
                # 构建带发送者上下文的文本
                lines = []
                for c in sorted(group_comms, key=lambda x: x.comm_time or x.created_at):
                    sender = c.initiator or "未知发送者"
                    chat_label = f"[{c.chat_name or '私聊'}]" if c.comm_type == "chat" else ""
                    time_str = (c.comm_time or c.created_at).strftime("%m-%d %H:%M") if (c.comm_time or c.created_at) else ""
                    lines.append(f"{chat_label} {sender} ({time_str}): {c.content_text}")
                merged_text = "\n".join(lines)[:6000]
                llm_todos = await _llm_extract(merged_text, user_name)
                return group_comms, llm_todos

        results = await asyncio.gather(
            *[_extract_group(k, v) for k, v in group_items],
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, Exception):
                logger.warning("待办提取单组异常: %s", r)
                continue
            group_comms, llm_todos = r
            # 用最新一条 comm 作为 source
            latest_comm = max(group_comms, key=lambda c: c.comm_time or c.created_at)
            for t in llm_todos:
                if not isinstance(t, dict) or not t.get("title"):
                    continue
                todos.append({
                    **t,
                    "source_type": "communication",
                    "source_id": latest_comm.id,
                    "source_text": latest_comm.content_text[:200],
                })

    logger.info("待办提取: 跳过已处理=%d, 跳过无内容=%d, 共提取原始待办=%d",
                skipped_processed, skipped_no_content, len(todos))
    return todos


async def extract_and_save(
    db: AsyncSession,
    owner_id: str,
    user_name: str = "",
    days: int = 2,
) -> list[TodoItem]:
    """提取待办并去重保存到数据库。"""
    all_todos = await extract_todos_from_communications(db, owner_id, user_name, days)

    if not all_todos:
        return []

    # 按 title 去重
    seen_titles: set[str] = set()
    unique_todos = []
    for t in all_todos:
        title_key = t["title"].strip().lower()
        if title_key not in seen_titles:
            seen_titles.add(title_key)
            unique_todos.append(t)

    # 用 content_hash 去重（hash = source_type + source_id + title，精确到来源）
    # 不同沟通记录产生的同名待办允许重复创建（因为是不同场景下的任务）
    # 已驳回(dismissed)的待办不参与去重，允许重新提取
    active_filter = and_(
        TodoItem.owner_id == owner_id,
        TodoItem.status != "dismissed",
    )
    existing_hash_result = await db.execute(
        select(TodoItem.content_hash).where(
            and_(active_filter, TodoItem.content_hash.isnot(None))
        )
    )
    existing_hashes = {r for r in existing_hash_result.scalars().all()}

    logger.info("待办保存: 原始待办=%d, 去重后=%d, 已有hash=%d",
                len(all_todos), len(unique_todos), len(existing_hashes))

    saved = []
    skipped_dedup = 0
    for t in unique_todos:
        title_lower = t["title"].strip().lower()
        content_hash = hashlib.md5(
            f"{t['source_type']}:{t.get('source_id', '')}:{title_lower}".encode()
        ).hexdigest()

        if content_hash in existing_hashes:
            skipped_dedup += 1
            continue

        due_date = None
        if t.get("due_date"):
            try:
                due_date = datetime.fromisoformat(str(t["due_date"]))
            except (ValueError, TypeError):
                pass

        item = TodoItem(
            owner_id=owner_id,
            title=t["title"][:512],
            description=t.get("description"),
            due_date=due_date,
            priority=t.get("priority", "medium"),
            source_type=t["source_type"],
            source_id=t.get("source_id"),
            source_text=t.get("source_text"),
            status="pending_review",
            content_hash=content_hash,
        )
        db.add(item)
        saved.append(item)

    if saved:
        await db.commit()
        for item in saved:
            await db.refresh(item)

    logger.info("待办保存: 去重跳过=%d, 最终保存=%d", skipped_dedup, len(saved))
    return saved


def _fix_json(text: str) -> str:
    """修复 LLM 返回的非标准 JSON（尾逗号、单引号等）。"""
    import re
    # 移除尾逗号（对象和数组最后一个元素后的逗号）
    text = re.sub(r",\s*([}\]])", r"\1", text)
    # 替换单引号为双引号（简单场景）
    # 只替换不在双引号字符串内部的单引号
    text = re.sub(r"(?<![\\])'\s*:", '":', text)
    text = re.sub(r":\s*'([^']*)'", r': "\1"', text)
    text = re.sub(r"^\s*'([^']*)'\s*:", r'"\1":', text, flags=re.MULTILINE)
    return text


async def _llm_extract(content: str, user_name: str = "") -> list[dict]:
    """调用LLM从文本中提取属于指定用户的待办。"""
    prompt = EXTRACT_TODO_PROMPT.format(content=content, user_name=user_name or "未知用户")

    try:
        response = await llm_client.chat_client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
        )
        result_text = response.choices[0].message.content.strip()

        # 提取 JSON 代码块
        if "```" in result_text:
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
            result_text = result_text.strip()

        # 尝试直接解析
        try:
            items = json.loads(result_text)
        except json.JSONDecodeError:
            # 修复常见格式问题后重试
            fixed = _fix_json(result_text)
            try:
                items = json.loads(fixed)
            except json.JSONDecodeError:
                # 最后尝试：用正则提取 JSON 数组
                import re
                match = re.search(r"\[[\s\S]*\]", result_text)
                if match:
                    fixed2 = _fix_json(match.group())
                    items = json.loads(fixed2)
                else:
                    raise

        if isinstance(items, list):
            return items
        return []
    except Exception as e:
        logger.warning("LLM提取待办失败: %s", e)
        return []
