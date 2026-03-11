"""清洗规则 CRUD API。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.cleaning_rule import CleaningRule
from app.schemas.cleaning_rule import (
    CleaningRuleCreate,
    CleaningRuleOut,
    CleaningRuleUpdate,
)

router = APIRouter(prefix="/api/cleaning-rules", tags=["cleaning-rules"])


@router.get("", response_model=list[CleaningRuleOut])
async def list_rules(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(CleaningRule)
        .where(CleaningRule.owner_id == user.feishu_open_id)
        .order_by(CleaningRule.updated_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=CleaningRuleOut)
async def create_rule(
    body: CleaningRuleCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    rule = CleaningRule(
        owner_id=user.feishu_open_id,
        name=body.name,
        options=body.options.model_dump(),
        field_hint=body.field_hint,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=CleaningRuleOut)
async def update_rule(
    rule_id: int,
    body: CleaningRuleUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(CleaningRule).where(
            CleaningRule.id == rule_id,
            CleaningRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "规则不存在")
    if body.name is not None:
        rule.name = body.name
    if body.options is not None:
        rule.options = body.options.model_dump()
    if body.field_hint is not None:
        rule.field_hint = body.field_hint
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
        select(CleaningRule).where(
            CleaningRule.id == rule_id,
            CleaningRule.owner_id == user.feishu_open_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "规则不存在")
    await db.delete(rule)
    await db.commit()
    return {"ok": True}
