"""提取规则 CRUD API。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.extraction_rule import ExtractionRule
from app.schemas.extraction_rule import (
    ExtractionRuleCreate,
    ExtractionRuleOut,
    ExtractionRuleUpdate,
)
from app.services.extraction_templates import SECTOR_LABELS, SECTOR_TEMPLATES, get_template_fields

router = APIRouter(prefix="/api/extraction-rules", tags=["extraction-rules"])


@router.get("", response_model=list[ExtractionRuleOut])
async def list_rules(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(ExtractionRule)
        .where(ExtractionRule.owner_id == user.feishu_open_id)
        .order_by(ExtractionRule.updated_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=ExtractionRuleOut)
async def create_rule(
    body: ExtractionRuleCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    rule = ExtractionRule(
        owner_id=user.feishu_open_id,
        name=body.name,
        sectors=body.sectors,
        fields=[f.model_dump() for f in body.fields],
        prompt_hint=body.prompt_hint,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=ExtractionRuleOut)
async def update_rule(
    rule_id: int,
    body: ExtractionRuleUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(ExtractionRule).where(
            ExtractionRule.id == rule_id,
            ExtractionRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "规则不存在")
    if body.name is not None:
        rule.name = body.name
    if body.sectors is not None:
        rule.sectors = body.sectors
    if body.fields is not None:
        rule.fields = [f.model_dump() for f in body.fields]
    if body.prompt_hint is not None:
        rule.prompt_hint = body.prompt_hint
    if body.is_active is not None:
        rule.is_active = body.is_active
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(ExtractionRule).where(
            ExtractionRule.id == rule_id,
            ExtractionRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "规则不存在")
    await db.delete(rule)
    await db.commit()
    return {"ok": True}


@router.get("/templates")
async def get_templates():
    return {
        "sectors": SECTOR_LABELS,
        "templates": {k: v for k, v in SECTOR_TEMPLATES.items() if k != "common"},
        "common_fields": SECTOR_TEMPLATES["common"],
        "get_fields_example": get_template_fields(["energy"]),
    }
