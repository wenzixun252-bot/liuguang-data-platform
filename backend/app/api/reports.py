"""报告 API 端点。"""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.report import Report, ReportTemplate
from app.models.user import User
from app.schemas.report import (
    ReportGenerateRequest,
    ReportListResponse,
    ReportOut,
    ReportTemplateCreate,
    ReportTemplateOut,
    ReportUpdate,
)
from app.services.feishu import feishu_client, FeishuAPIError
from app.services.report_generator import (
    ensure_system_templates,
    generate_report,
    generate_report_stream,
    start_report_background,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["报告"])


@router.get("/report-templates", response_model=list[ReportTemplateOut], summary="模板列表")
async def list_templates(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取报告模板列表（系统模板 + 用户自定义模板）。"""
    await ensure_system_templates(db)

    result = await db.execute(
        select(ReportTemplate).where(
            (ReportTemplate.template_type == "system")
            | (ReportTemplate.owner_id == current_user.feishu_open_id)
        ).order_by(ReportTemplate.created_at)
    )
    return result.scalars().all()


@router.post("/report-templates", response_model=ReportTemplateOut, summary="创建自定义模板")
async def create_template(
    body: ReportTemplateCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """创建自定义报告模板。"""
    template = ReportTemplate(
        name=body.name,
        template_type="custom",
        owner_id=current_user.feishu_open_id,
        prompt_template=body.prompt_template,
        output_structure=body.output_structure,
        description=body.description,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.post("/reports/generate", response_model=ReportOut, summary="生成报告")
async def create_report(
    body: ReportGenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """生成报告（非流式）。"""
    report = await generate_report(
        db=db,
        owner_id=current_user.feishu_open_id,
        template_id=body.template_id,
        title=body.title,
        time_start=body.time_range_start,
        time_end=body.time_range_end,
        data_sources=body.data_sources,
        extra_instructions=body.extra_instructions,
        target_reader_ids=body.target_reader_ids,
    )
    return report


@router.post("/reports/generate/stream", summary="流式生成报告 (SSE)")
async def create_report_stream(
    body: ReportGenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """流式生成报告。"""
    async def _event_generator():
        try:
            async for chunk in generate_report_stream(
                db=db,
                owner_id=current_user.feishu_open_id,
                template_id=body.template_id,
                title=body.title,
                time_start=body.time_range_start,
                time_end=body.time_range_end,
                data_sources=body.data_sources,
                extra_instructions=body.extra_instructions,
                target_reader_ids=body.target_reader_ids,
            ):
                yield f"data: {chunk}\n\n"
        except Exception as e:
            logger.error("流式报告 SSE 异常: %s", e, exc_info=True)
            err = json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False)
            yield f"data: {err}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/reports/generate/background", response_model=ReportOut, summary="后台生成报告")
async def create_report_background(
    body: ReportGenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """后台异步生成报告，立即返回报告记录（status=generating）。

    前端通过轮询 GET /reports/{id} 查看生成状态。
    """
    report = await start_report_background(
        db=db,
        owner_id=current_user.feishu_open_id,
        template_id=body.template_id,
        title=body.title,
        time_start=body.time_range_start,
        time_end=body.time_range_end,
        data_sources=body.data_sources,
        extra_instructions=body.extra_instructions,
        target_reader_ids=body.target_reader_ids,
    )
    return report


@router.get("/reports", response_model=ReportListResponse, summary="报告列表")
async def list_reports(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    status: str | None = Query(None),
):
    """获取用户的报告列表。"""
    conditions = [Report.owner_id == current_user.feishu_open_id]

    if search:
        conditions.append(Report.title.ilike(f"%{search}%"))

    if status:
        conditions.append(Report.status == status)

    count_result = await db.execute(
        select(func.count()).select_from(Report).where(and_(*conditions))
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(Report)
        .where(and_(*conditions))
        .order_by(Report.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = result.scalars().all()

    return ReportListResponse(items=items, total=total)


@router.get("/reports/{report_id}", response_model=ReportOut, summary="报告详情")
async def get_report(
    report_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取报告详情。"""
    report = await db.get(Report, report_id)
    if not report or report.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="报告不存在")
    return report


@router.put("/reports/{report_id}", response_model=ReportOut, summary="编辑报告")
async def update_report(
    report_id: int,
    body: ReportUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """编辑报告内容。"""
    report = await db.get(Report, report_id)
    if not report or report.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="报告不存在")

    if body.title is not None:
        report.title = body.title
    if body.content_markdown is not None:
        report.content_markdown = body.content_markdown

    await db.commit()
    await db.refresh(report)
    return report


@router.post("/reports/{report_id}/push-feishu", response_model=ReportOut, summary="推送到飞书云文档")
async def push_report_to_feishu(
    report_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """推送报告到飞书云文档。"""
    report = await db.get(Report, report_id)
    if not report or report.owner_id != current_user.feishu_open_id:
        raise HTTPException(status_code=404, detail="报告不存在")

    if not report.content_markdown:
        raise HTTPException(status_code=400, detail="报告内容为空，无法推送")

    # 刷新飞书 token
    if not current_user.feishu_refresh_token:
        raise HTTPException(status_code=400, detail="缺少飞书 refresh_token，请重新登录")
    try:
        token_data = await feishu_client.refresh_user_access_token(current_user.feishu_refresh_token)
        current_user.feishu_access_token = token_data["access_token"]
        current_user.feishu_refresh_token = token_data.get("refresh_token", current_user.feishu_refresh_token)
        await db.commit()
    except FeishuAPIError:
        raise HTTPException(status_code=401, detail="飞书 token 刷新失败，请重新登录")

    try:
        doc_info = await feishu_client.create_document(
            title=report.title,
            content=report.content_markdown,
            user_access_token=current_user.feishu_access_token,
            user_open_id=current_user.feishu_open_id,
        )
        report.feishu_doc_token = doc_info.get("document_id")
        report.feishu_doc_url = doc_info.get("url")
        report.status = "published"
        await db.commit()
        await db.refresh(report)
        return report
    except FeishuAPIError as e:
        err_msg = str(e)
        if "重新登录" in err_msg:
            raise HTTPException(status_code=401, detail=err_msg)
        raise HTTPException(status_code=502, detail=f"飞书文档创建失败: {e}")


class BatchDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/reports/batch-delete", summary="批量删除报告")
async def batch_delete_reports(
    body: BatchDeleteRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """批量删除报告（仅限 owner）。"""
    result = await db.execute(
        select(Report).where(
            Report.id.in_(body.ids),
            Report.owner_id == current_user.feishu_open_id,
        )
    )
    rows = result.scalars().all()

    for row in rows:
        await db.delete(row)

    await db.commit()
    return {"deleted": len(rows)}
