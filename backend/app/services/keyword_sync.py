"""关键词同步服务 — 使用飞书搜索 API 搜索用户可访问的全部文档（含他人分享），匹配关键词后导入到 documents 表。"""

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.keyword_sync_rule import KeywordSyncRule
from app.services.cloud_doc_import import cloud_doc_import_service
from app.services.feishu import FeishuAPIError, feishu_client

logger = logging.getLogger(__name__)


@dataclass
class KeywordSyncResult:
    """关键词同步结果。"""
    keyword: str
    matched: int = 0
    imported: int = 0
    skipped: int = 0
    failed: int = 0


async def sync_single_rule(
    rule: KeywordSyncRule,
    db: AsyncSession,
    user_access_token: str,
    asset_owner_name: str | None = None,
) -> KeywordSyncResult:
    """执行单条关键词规则的同步。

    使用飞书搜索 API 直接搜索关键词，返回用户有阅读权限的全部匹配文档
    （包括自己创建的 + 他人分享的 + 知识空间中的），然后批量导入到 documents 表。
    """
    result = KeywordSyncResult(keyword=rule.keyword)

    # 1. 通过飞书搜索 API 查找所有匹配的可访问文档
    try:
        matched_docs = await feishu_client.search_accessible_docs(
            keyword=rule.keyword,
            user_access_token=user_access_token,
            doc_types=["doc", "docx", "file", "wiki"],
        )
    except FeishuAPIError as e:
        logger.error("关键词「%s」搜索失败: %s", rule.keyword, e)
        return result

    result.matched = len(matched_docs)
    logger.info("关键词「%s」搜索到 %d 个文档", rule.keyword, result.matched)

    if not matched_docs:
        return result

    # 2. 批量导入匹配文档，并应用规则配置的默认标签
    tag_ids: list[int] = rule.default_tag_ids if rule.default_tag_ids else []

    import_result = await cloud_doc_import_service.batch_import(
        matched_docs,
        owner_id=rule.owner_id,
        db=db,
        user_access_token=user_access_token,
        tag_ids=tag_ids,
    )

    result.imported = import_result.imported
    result.skipped = import_result.skipped
    result.failed = import_result.failed

    # 3. 更新规则的匹配数和扫描时间
    from datetime import datetime
    rule_obj = await db.get(KeywordSyncRule, rule.id)
    if rule_obj:
        rule_obj.docs_matched = result.matched
        rule_obj.last_scan_time = datetime.utcnow()
        await db.commit()

    return result


async def sync_all_keyword_rules(
    owner_id: str,
    db: AsyncSession,
    user_access_token: str,
    asset_owner_name: str | None = None,
) -> list[KeywordSyncResult]:
    """同步该用户所有启用的关键词规则。"""
    stmt = select(KeywordSyncRule).where(
        KeywordSyncRule.owner_id == owner_id,
        KeywordSyncRule.is_enabled == True,  # noqa: E712
    )
    result = await db.execute(stmt)
    rules = result.scalars().all()

    if not rules:
        logger.info("用户 %s 没有启用的关键词规则", owner_id)
        return []

    results: list[KeywordSyncResult] = []
    for rule in rules:
        sync_result = await sync_single_rule(rule, db, user_access_token, asset_owner_name)
        results.append(sync_result)
        logger.info(
            "关键词「%s」: 匹配 %d, 导入 %d, 跳过 %d, 失败 %d",
            rule.keyword, sync_result.matched, sync_result.imported,
            sync_result.skipped, sync_result.failed,
        )

    return results
