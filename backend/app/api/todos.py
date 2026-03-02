"""待办事项 API 端点。"""

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.todo_item import TodoItem
from app.models.user import User
from app.schemas.todo import (
    TodoBatchConfirm,
    TodoBatchPush,
    TodoExtractRequest,
    TodoListResponse,
    TodoOut,
    TodoUpdate,
)
from app.services.feishu import feishu_client, FeishuAPIError
from app.services.todo_extractor import extract_and_save

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/todos", tags=["待办事项"])


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


@router.post("/extract", response_model=list[TodoOut], summary="AI提取待办候选")
async def extract_todos(
    body: TodoExtractRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """从近N天会议/聊天中AI提取待办候选。"""
    items = await extract_and_save(db, current_user.feishu_open_id, body.days)
    return items


@router.get("", response_model=TodoListResponse, summary="待办列表")
async def list_todos(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """获取待办列表，可按 status 过滤。"""
    conditions = [TodoItem.owner_id == current_user.feishu_open_id]
    if status_filter:
        conditions.append(TodoItem.status == status_filter)

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
        todo.status = body.status

    await db.commit()
    await db.refresh(todo)
    return todo


@router.post("/batch-confirm", response_model=list[TodoOut], summary="批量确认")
async def batch_confirm(
    body: TodoBatchConfirm,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """批量确认待办。"""
    result = await db.execute(
        select(TodoItem).where(
            and_(
                TodoItem.id.in_(body.ids),
                TodoItem.owner_id == current_user.feishu_open_id,
            )
        )
    )
    items = result.scalars().all()

    for item in items:
        if item.status == "pending_review":
            item.status = "confirmed"

    await db.commit()
    for item in items:
        await db.refresh(item)
    return items


@router.post("/{todo_id}/push-feishu", response_model=TodoOut, summary="推送到飞书任务")
async def push_to_feishu(
    todo_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """推送单条待办到飞书任务。"""
    todo = await db.get(TodoItem, todo_id)
    if not todo or todo.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="待办不存在")

    if todo.status not in ("confirmed", "pending_review"):
        raise HTTPException(status_code=400, detail="只能推送已确认或待确认的待办")

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
        todo.status = "pushed"
        todo.pushed_at = datetime.utcnow()
        await db.commit()
        await db.refresh(todo)
        return todo
    except FeishuAPIError as e:
        raise HTTPException(status_code=502, detail=f"飞书任务创建失败: {e}")


@router.post("/batch-push", response_model=list[TodoOut], summary="批量推送")
async def batch_push(
    body: TodoBatchPush,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """批量推送待办到飞书任务。"""
    access_token = await _ensure_fresh_token(current_user, db)

    result = await db.execute(
        select(TodoItem).where(
            and_(
                TodoItem.id.in_(body.ids),
                TodoItem.owner_id == current_user.feishu_open_id,
                TodoItem.status.in_(["confirmed", "pending_review"]),
            )
        )
    )
    items = result.scalars().all()

    pushed = []
    for item in items:
        try:
            task_id = await feishu_client.create_task(
                title=item.title,
                description=item.description or "",
                due_date=item.due_date,
                user_access_token=access_token,
                user_open_id=current_user.feishu_open_id,
            )
            item.feishu_task_id = task_id
            item.status = "pushed"
            item.pushed_at = datetime.utcnow()
            pushed.append(item)
        except FeishuAPIError as e:
            logger.warning("批量推送待办 %d 失败: %s", item.id, e)

    await db.commit()
    for item in pushed:
        await db.refresh(item)
    return pushed
