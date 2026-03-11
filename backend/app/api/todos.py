"""待办事项 API 端点。"""

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
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
from app.services.todo_extractor import extract_and_save

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/todos", tags=["待办事项"])

# 允许的状态转换
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "pending_review": {"in_progress", "dismissed"},
    "in_progress": {"completed"},
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
            TodoItem.status != "dismissed",
        ))
        .order_by(TodoItem.created_at.desc())
        .limit(5)
    )
    recent = recent_result.scalars().all()

    return {
        "status_counts": status_counts,
        "recent": [TodoOut.model_validate(t) for t in recent],
    }


@router.post("/extract", response_model=list[TodoOut], summary="AI提取待办候选")
async def extract_todos(
    body: TodoExtractRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """从近N天会议/聊天中AI提取待办候选。"""
    try:
        items = await extract_and_save(db, current_user.feishu_open_id, current_user.name, body.days)
        return items
    except Exception as e:
        logger.exception("待办提取接口异常: %s", e)
        raise HTTPException(status_code=500, detail=f"待办提取失败: {e}")


@router.get("", response_model=TodoListResponse, summary="待办列表")
async def list_todos(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """获取待办列表，可按 status 过滤。"""
    conditions = [TodoItem.owner_id == current_user.feishu_open_id]
    if status_filter:
        conditions.append(TodoItem.status == status_filter)
    if search:
        like = f"%{search}%"
        conditions.append(TodoItem.title.ilike(like) | TodoItem.description.ilike(like))

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

    if todo.status not in ("pending_review", "in_progress"):
        raise HTTPException(status_code=400, detail="只能推送待确认或进行中的待办")

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
