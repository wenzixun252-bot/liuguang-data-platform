"""待办事项 API 端点。"""

import asyncio
import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.database import async_session
from app.models.todo_item import TodoItem
from app.models.user import User
from app.schemas.todo import (
    TodoExtractRequest,
    TodoListResponse,
    TodoOut,
    TodoStatusUpdate,
    TodoUpdate,
)
from app.services.feishu import feishu_client, FeishuAPIError
from app.services.todo_extractor import extract_and_save, auto_push_high_confidence_todos

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/todos", tags=["待办事项"])

# ── 待办提取任务状态（进程内存） ──
# key: owner_id, value: {status, message, count?}
_extract_tasks: dict[str, dict] = {}

# 允许的状态转换
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "in_progress": {"completed", "cancelled"},
}


async def _ensure_fresh_token(user: User, db: AsyncSession) -> str:
    """确保用户飞书 token 有效，如需要则刷新。返回可用的 access_token。"""
    if not user.feishu_refresh_token:
        raise HTTPException(status_code=400, detail="缺少飞书 refresh_token，请重新登录")
    try:
        token_data = await feishu_client.refresh_user_access_token(user.feishu_refresh_token)
        user.feishu_access_token = token_data["access_token"]
        user.feishu_refresh_token = token_data.get("refresh_token", user.feishu_refresh_token)
        await db.commit()
        return user.feishu_access_token
    except FeishuAPIError:
        raise HTTPException(status_code=401, detail="飞书 token 刷新失败，请重新登录")


@router.get("/summary", summary="待办摘要（看板用）")
async def todo_summary(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """返回各状态待办数量 + 最近5条待办，用于看板展示。"""
    owner_id = current_user.feishu_open_id

    # 各状态数量
    count_result = await db.execute(
        select(TodoItem.status, func.count(TodoItem.id))
        .where(TodoItem.owner_id == owner_id)
        .group_by(TodoItem.status)
    )
    status_counts = dict(count_result.all())

    # 最近5条（排除已驳回的）
    recent_result = await db.execute(
        select(TodoItem)
        .where(and_(
            TodoItem.owner_id == owner_id,
            TodoItem.status != "cancelled",
        ))
        .order_by(TodoItem.created_at.desc())
        .limit(5)
    )
    recent = recent_result.scalars().all()

    return {
        "status_counts": status_counts,
        "recent": [TodoOut.model_validate(t) for t in recent],
    }


async def _run_extract_task(owner_id: str, owner_name: str, days: int) -> None:
    """后台执行待办提取，使用独立的数据库会话。"""
    try:
        _extract_tasks[owner_id] = {"status": "running", "message": "正在提取待办..."}
        async with async_session() as db:
            items = await extract_and_save(db, owner_id, owner_name, days)
            # 自动推送高置信度待办到飞书
            pushed = 0
            if items:
                from app.models.user import User
                result = await db.execute(
                    select(User).where(User.feishu_open_id == owner_id)
                )
                user = result.scalar_one_or_none()
                user_token = user.feishu_access_token if user else None
                pushed = await auto_push_high_confidence_todos(db, items, user_token)
            msg = f"提取完成，共 {len(items)} 条"
            if pushed:
                msg += f"，{pushed} 条已自动推送飞书"
            _extract_tasks[owner_id] = {
                "status": "done",
                "message": msg,
                "count": len(items),
                "pushed": pushed,
            }
    except Exception as e:
        logger.exception("后台待办提取失败: %s", e)
        _extract_tasks[owner_id] = {"status": "error", "message": f"提取失败: {e}"}


@router.post("/extract", summary="AI提取待办候选")
async def extract_todos(
    body: TodoExtractRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """从近N天会议/聊天中AI提取待办候选。立即返回，后台异步执行。"""
    owner_id = current_user.feishu_open_id
    existing = _extract_tasks.get(owner_id)
    if existing and existing.get("status") == "running":
        return {"status": "running", "message": "待办提取任务已在运行中"}

    asyncio.create_task(_run_extract_task(owner_id, current_user.name, body.days))
    return {"status": "started", "message": "待办提取已触发"}


@router.get("/extract-status", summary="查询待办提取进度")
async def get_extract_status(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """查询当前用户的待办提取任务状态。"""
    task = _extract_tasks.get(current_user.feishu_open_id)
    if not task:
        return {"status": "idle", "message": "无提取任务"}
    return task


@router.get("", response_model=TodoListResponse, summary="待办列表")
async def list_todos(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    date_field: str | None = Query(None, description="时间筛选字段: created_at, due_date, pushed_at"),
    date_from: datetime | None = Query(None, description="时间范围开始"),
    date_to: datetime | None = Query(None, description="时间范围结束"),
):
    """获取待办列表，可按 status 过滤。"""
    conditions = [TodoItem.owner_id == current_user.feishu_open_id]
    if status_filter:
        conditions.append(TodoItem.status == status_filter)
    if search:
        like = f"%{search}%"
        conditions.append(TodoItem.title.ilike(like) | TodoItem.description.ilike(like))

    # 时间范围筛选
    _date_field_map = {
        "created_at": TodoItem.created_at,
        "due_date": TodoItem.due_date,
        "pushed_at": TodoItem.pushed_at,
    }
    if date_field and date_field in _date_field_map:
        col = _date_field_map[date_field]
        if date_from:
            conditions.append(col >= date_from)
        if date_to:
            conditions.append(col <= date_to)

    # 总数
    count_result = await db.execute(
        select(func.count()).select_from(TodoItem).where(and_(*conditions))
    )
    total = count_result.scalar() or 0

    # 分页查询
    result = await db.execute(
        select(TodoItem)
        .where(and_(*conditions))
        .order_by(TodoItem.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = result.scalars().all()

    return TodoListResponse(items=items, total=total)


@router.patch("/{todo_id}", response_model=TodoOut, summary="编辑/确认/驳回待办")
async def update_todo(
    todo_id: int,
    body: TodoUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """编辑待办：修改标题、截止日期、优先级、确认或驳回。"""
    todo = await db.get(TodoItem, todo_id)
    if not todo or todo.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="待办不存在")

    if body.title is not None:
        todo.title = body.title
    if body.description is not None:
        todo.description = body.description
    if body.due_date is not None:
        todo.due_date = body.due_date
    if body.priority is not None:
        todo.priority = body.priority
    if body.status is not None:
        allowed = ALLOWED_TRANSITIONS.get(todo.status, set())
        if body.status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"不允许从 {todo.status} 转换到 {body.status}",
            )
        todo.status = body.status
        if body.status == "completed":
            todo.completed_at = datetime.utcnow()
            if todo.feishu_task_id:
                await feishu_client.complete_task(todo.feishu_task_id)
        elif body.status == "cancelled":
            todo.cancelled_at = datetime.utcnow()
            if todo.feishu_task_id:
                await feishu_client.delete_task(todo.feishu_task_id)
                todo.feishu_task_id = None
                todo.pushed_at = None

    await db.commit()
    await db.refresh(todo)
    return todo


@router.post("/batch-status", response_model=list[TodoOut], summary="批量改状态")
async def batch_status(
    body: TodoStatusUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """批量变更待办状态。"""
    result = await db.execute(
        select(TodoItem).where(
            and_(
                TodoItem.id.in_(body.ids),
                TodoItem.owner_id == current_user.feishu_open_id,
            )
        )
    )
    items = result.scalars().all()

    updated = []
    for item in items:
        allowed = ALLOWED_TRANSITIONS.get(item.status, set())
        if body.status in allowed:
            item.status = body.status
            if body.status == "completed":
                item.completed_at = datetime.utcnow()
                if item.feishu_task_id:
                    await feishu_client.complete_task(item.feishu_task_id)
            elif body.status == "cancelled":
                item.cancelled_at = datetime.utcnow()
                if item.feishu_task_id:
                    await feishu_client.delete_task(item.feishu_task_id)
                    item.feishu_task_id = None
                    item.pushed_at = None
            updated.append(item)

    await db.commit()
    for item in updated:
        await db.refresh(item)
    return updated


class TodoBatchDelete(BaseModel):
    ids: list[int]


@router.post("/batch-delete", summary="批量删除待办")
async def batch_delete_todos(
    body: TodoBatchDelete,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """批量删除待办。"""
    result = await db.execute(
        select(TodoItem).where(
            TodoItem.id.in_(body.ids),
            TodoItem.owner_id == current_user.feishu_open_id,
        )
    )
    rows = result.scalars().all()

    for row in rows:
        await db.delete(row)

    await db.commit()
    return {"deleted": len(rows)}


@router.post("/{todo_id}/push-feishu", response_model=TodoOut, summary="推送到飞书任务")
async def push_to_feishu(
    todo_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """推送单条待办到飞书任务。推送后自动进入 in_progress 状态。"""
    todo = await db.get(TodoItem, todo_id)
    if not todo or todo.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="待办不存在")

    if todo.status != "in_progress":
        raise HTTPException(status_code=400, detail="只能推送进行中的待办")

    access_token = await _ensure_fresh_token(current_user, db)

    try:
        task_id = await feishu_client.create_task(
            title=todo.title,
            description=todo.description or "",
            due_date=todo.due_date,
            user_access_token=access_token,
            user_open_id=current_user.feishu_open_id,
        )
        todo.feishu_task_id = task_id
        todo.status = "in_progress"
        todo.pushed_at = datetime.utcnow()
        await db.commit()
        await db.refresh(todo)
        return todo
    except FeishuAPIError as e:
        raise HTTPException(status_code=502, detail=f"飞书任务创建失败: {e}")
