"""Graph-RAG 增强服务 — 通过知识图谱扩展 RAG 检索范围。"""

import json
import logging

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.content_entity_link import ContentEntityLink
from app.models.knowledge_graph import KGEntity, KGRelation

logger = logging.getLogger(__name__)


class GraphRAGEnhancer:
    """知识图谱增强检索：从问题提取实体 → 匹配图谱 → 一跳展开 → 找关联内容。"""

    async def enhance_search(
        self,
        question: str,
        owner_id: str,
        db: AsyncSession,
    ) -> list[tuple[str, int]]:
        """返回 [(content_type, content_id), ...] 关联内容列表。"""
        try:
            # 1. LLM 从问题中提取实体名
            entity_names = await self._extract_entities(question)
            if not entity_names:
                return []

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
                return []

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

            # 4. 通过 content_entity_links 找关联内容
            link_result = await db.execute(
                select(ContentEntityLink.content_type, ContentEntityLink.content_id)
                .where(ContentEntityLink.entity_id.in_(expanded_ids))
                .limit(20)
            )
            content_refs = list({(row[0], row[1]) for row in link_result.fetchall()})

            logger.info(
                "Graph-RAG: 提取实体 %s, 匹配 %d, 展开 %d, 关联内容 %d",
                entity_names, len(matched_entity_ids), len(expanded_ids), len(content_refs),
            )
            return content_refs

        except Exception as e:
            logger.warning("Graph-RAG 增强失败，静默降级: %s", e)
            return []

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
