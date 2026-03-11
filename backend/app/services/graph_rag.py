"""Graph-RAG 增强服务 — 通过知识图谱扩展 RAG 检索范围。"""

import json
import logging

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.content_entity_link import ContentEntityLink
from app.models.knowledge_graph import KGEntity, KGRelation
from app.models.tag import ContentTag, TagDefinition

logger = logging.getLogger(__name__)


class GraphRAGEnhancer:
    """知识图谱增强检索：从问题提取实体 → 匹配图谱 → 一跳展开 → 找关联内容。"""

    async def enhance_search(
        self,
        question: str,
        owner_id: str,
        db: AsyncSession,
    ) -> tuple[list[tuple[str, int]], list[str]]:
        """返回 ([(content_type, content_id), ...], [domain_label, ...])。"""
        try:
            # 1. LLM 从问题中提取实体名
            entity_names = await self._extract_entities(question)
            if not entity_names:
                return [], []

            # 2. 在 kg_entities 中模糊匹配
            matched_entity_ids: set[int] = set()
            for name in entity_names:
                result = await db.execute(
                    select(KGEntity.id).where(
                        and_(
                            KGEntity.owner_id == owner_id,
                            KGEntity.name.ilike(f"%{name}%"),
                        )
                    ).limit(5)
                )
                for row in result.fetchall():
                    matched_entity_ids.add(row[0])

            if not matched_entity_ids:
                return [], []

            # 3. 一跳展开：通过 kg_relations 找到相关实体
            expanded_ids = set(matched_entity_ids)
            if matched_entity_ids:
                rel_result = await db.execute(
                    select(KGRelation).where(
                        and_(
                            KGRelation.owner_id == owner_id,
                            (
                                KGRelation.source_entity_id.in_(matched_entity_ids)
                                | KGRelation.target_entity_id.in_(matched_entity_ids)
                            ),
                        )
                    ).limit(50)
                )
                for rel in rel_result.scalars().all():
                    expanded_ids.add(rel.source_entity_id)
                    expanded_ids.add(rel.target_entity_id)

            # 3.5 收集匹配实体的域标签 + 同域扩展
            domain_labels: set[str] = set()
            if matched_entity_ids:
                domain_result = await db.execute(
                    select(KGEntity.properties["domain_label"].astext)
                    .where(KGEntity.id.in_(matched_entity_ids))
                )
                for row in domain_result.fetchall():
                    if row[0]:
                        domain_labels.add(row[0])

            # 同域高重要性实体扩展：找到同业务域的其他重要实体
            if domain_labels:
                same_domain = await db.execute(
                    select(KGEntity.id).where(
                        and_(
                            KGEntity.owner_id == owner_id,
                            KGEntity.properties["domain_label"].astext.in_(domain_labels),
                            KGEntity.importance_score >= 0.3,
                            ~KGEntity.id.in_(expanded_ids),
                        )
                    ).limit(15)
                )
                domain_expanded = [row[0] for row in same_domain.fetchall()]
                expanded_ids.update(domain_expanded)
                if domain_expanded:
                    logger.info("同域扩展: 域 %s, 新增 %d 个实体", domain_labels, len(domain_expanded))

            # 4. 通过 content_entity_links 找关联内容
            link_result = await db.execute(
                select(ContentEntityLink.content_type, ContentEntityLink.content_id)
                .where(ContentEntityLink.entity_id.in_(expanded_ids))
                .limit(30)
            )
            content_refs = set((row[0], row[1]) for row in link_result.fetchall())

            # 5. 通过标签反向增强：实体名匹配标签名 → 找到同标签的其他内容
            tag_refs = await self._enhance_by_tags(entity_names, owner_id, db)
            content_refs.update(tag_refs)

            content_refs = list(content_refs)

            logger.info(
                "Graph-RAG: 提取实体 %s, 匹配 %d, 展开 %d, 域 %s, 关联内容 %d (标签增强 %d)",
                entity_names, len(matched_entity_ids), len(expanded_ids),
                list(domain_labels), len(content_refs), len(tag_refs),
            )
            return content_refs, list(domain_labels)

        except Exception as e:
            logger.warning("Graph-RAG 增强失败，静默降级: %s", e)
            return [], []

    async def _enhance_by_tags(
        self,
        entity_names: list[str],
        owner_id: str,
        db: AsyncSession,
    ) -> set[tuple[str, int]]:
        """通过实体名匹配标签，反向查找同标签的其他内容。"""
        tag_refs: set[tuple[str, int]] = set()
        try:
            for name in entity_names:
                # 模糊匹配标签名
                tag_result = await db.execute(
                    select(TagDefinition.id).where(
                        and_(
                            TagDefinition.name.ilike(f"%{name}%"),
                            TagDefinition.category.in_(["project", "topic"]),
                            or_(
                                TagDefinition.owner_id == owner_id,
                                TagDefinition.is_shared == True,  # noqa: E712
                            ),
                        )
                    ).limit(5)
                )
                tag_ids = [row[0] for row in tag_result.fetchall()]
                if not tag_ids:
                    continue

                # 查找使用这些标签的内容
                ct_result = await db.execute(
                    select(ContentTag.content_type, ContentTag.content_id)
                    .where(ContentTag.tag_id.in_(tag_ids))
                    .limit(15)
                )
                for row in ct_result.fetchall():
                    tag_refs.add((row[0], row[1]))
        except Exception as e:
            logger.warning("标签增强检索失败: %s", e)
        return tag_refs

    async def _extract_entities(self, question: str) -> list[str]:
        """用 LLM 从问题中提取实体名。"""
        try:
            from app.services.llm import llm_client

            response = await llm_client.chat_client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "从用户问题中提取关键实体名称（人名、项目名、组织名等）。"
                            "只输出 JSON 数组，如 [\"张三\", \"项目A\"]。"
                            "如果没有明确实体，输出空数组 []。"
                        ),
                    },
                    {"role": "user", "content": question},
                ],
                temperature=0.0,
                max_tokens=200,
            )
            result_text = response.choices[0].message.content.strip()
            if "```" in result_text:
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
                result_text = result_text.strip()
            return json.loads(result_text)
        except Exception as e:
            logger.warning("实体提取失败: %s", e)
            return []


# 模块级单例
graph_rag_enhancer = GraphRAGEnhancer()
