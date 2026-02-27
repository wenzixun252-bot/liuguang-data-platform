"""ETL Load 模块 — Embedding 生成 + 数据 Upsert 入库。"""

import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import ETLSyncState
from app.services.etl.transformer import TransformResult
from app.services.llm import llm_client

logger = logging.getLogger(__name__)


class AssetLoader:
    """数据加载器：生成 Embedding + Upsert 到 data_assets 表。"""

    async def load(
        self,
        transform_result: TransformResult,
        db: AsyncSession,
    ) -> int:
        """将转换后的记录生成 Embedding 并 Upsert 入库。

        Returns:
            成功入库的记录数。
        """
        records = transform_result.records
        if not records:
            return 0

        # 1. 批量生成 Embedding
        texts = [
            f"{r.title or ''} {r.content_text}".strip() for r in records
        ]
        embeddings = await llm_client.batch_generate_embeddings(texts)

        # 2. 逐条 Upsert
        loaded_count = 0
        for record, embedding in zip(records, embeddings):
            try:
                # 使用原生 SQL 执行 Upsert (PostgreSQL ON CONFLICT)
                vector_str = f"[{','.join(str(v) for v in embedding)}]" if embedding else None

                await db.execute(
                    text("""
                        INSERT INTO data_assets (
                            feishu_record_id, owner_id, source_app_token, source_table_id,
                            asset_type, title, content_text, content_vector, asset_tags,
                            feishu_created_at, feishu_updated_at, synced_at, created_at, updated_at
                        ) VALUES (
                            :feishu_record_id, :owner_id, :source_app_token, :source_table_id,
                            :asset_type, :title, :content_text,
                            :content_vector,
                            :asset_tags::jsonb,
                            :feishu_created_at, :feishu_updated_at,
                            now(), now(), now()
                        )
                        ON CONFLICT (feishu_record_id) DO UPDATE SET
                            content_text = EXCLUDED.content_text,
                            content_vector = EXCLUDED.content_vector,
                            asset_tags = EXCLUDED.asset_tags,
                            title = EXCLUDED.title,
                            feishu_updated_at = EXCLUDED.feishu_updated_at,
                            synced_at = now(),
                            updated_at = now()
                    """),
                    {
                        "feishu_record_id": record.feishu_record_id,
                        "owner_id": record.owner_id,
                        "source_app_token": record.source_app_token,
                        "source_table_id": record.source_table_id,
                        "asset_type": record.asset_type,
                        "title": record.title,
                        "content_text": record.content_text,
                        "content_vector": vector_str,
                        "asset_tags": _dict_to_json(record.asset_tags),
                        "feishu_created_at": record.feishu_created_at,
                        "feishu_updated_at": record.feishu_updated_at,
                    },
                )
                loaded_count += 1
            except Exception as e:
                logger.error(
                    "Upsert 失败 (record_id=%s): %s",
                    record.feishu_record_id,
                    e,
                )

        await db.commit()

        # 3. 更新 sync_state
        await self._update_sync_state(
            db,
            transform_result.app_token,
            transform_result.table_id,
            loaded_count,
        )

        logger.info(
            "数据加载完成: %s/%s, 成功 %d/%d 条",
            transform_result.app_token,
            transform_result.table_id,
            loaded_count,
            len(records),
        )
        return loaded_count

    @staticmethod
    async def _update_sync_state(
        db: AsyncSession,
        app_token: str,
        table_id: str,
        records_synced: int,
    ) -> None:
        """更新 etl_sync_state 为 success。"""
        from sqlalchemy import select

        result = await db.execute(
            select(ETLSyncState).where(
                ETLSyncState.source_app_token == app_token,
                ETLSyncState.source_table_id == table_id,
            )
        )
        sync_state = result.scalar_one_or_none()
        if sync_state:
            sync_state.last_sync_status = "success"
            sync_state.records_synced = records_synced
            sync_state.last_sync_time = datetime.now(timezone.utc)
            sync_state.error_message = None
            await db.commit()


def _dict_to_json(d: dict) -> str:
    """将字典序列化为 JSON 字符串（用于 PostgreSQL JSONB 参数绑定）。"""
    import json
    return json.dumps(d, ensure_ascii=False, default=str)


# 模块级单例
asset_loader = AssetLoader()
