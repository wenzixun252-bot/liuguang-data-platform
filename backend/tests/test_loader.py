"""ETL Load 模块单元测试。"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import ETLSyncState
from app.services.etl.loader import AssetLoader, _dict_to_json
from app.services.etl.transformer import TransformResult, TransformedDocument

pytestmark = pytest.mark.asyncio


def _make_mock_db():
    """创建一个 mock AsyncSession，execute 返回的结果默认 scalar_one_or_none=None。"""
    mock_db = AsyncMock(spec=AsyncSession)
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_result.fetchone.return_value = None
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()
    # begin_nested 返回一个 async context manager
    mock_nested = AsyncMock()
    mock_db.begin_nested = MagicMock(return_value=mock_nested)
    return mock_db


class TestAssetLoader:
    """AssetLoader 测试。"""

    def _make_transform_result(self, records=None):
        return TransformResult(
            records=records or [],
            app_token="app1",
            table_id="tbl1",
        )

    async def test_load_empty_records(self, db_session):
        """空记录列表返回 0。"""
        loader = AssetLoader()
        result = await loader.load(self._make_transform_result(), db_session)
        assert result == 0

    async def test_batch_generate_embeddings_called(self):
        """验证 Embedding 批量生成被调用。"""
        records = [
            TransformedDocument(
                feishu_record_id="rec_001",
                owner_id="ou_abc",
                source_app_token="app1",
                source_table_id="tbl1",
                content_text="测试内容",
                title="标题",
            ),
        ]
        transform_result = self._make_transform_result(records)
        mock_db = _make_mock_db()

        with patch(
            "app.services.llm.llm_client.batch_generate_embeddings",
            new_callable=AsyncMock,
            return_value=[[0.1] * 1536],
        ) as mock_embed:
            loader = AssetLoader()
            with patch.object(loader, "_update_sync_state", new_callable=AsyncMock):
                await loader.load(transform_result, mock_db)

            mock_embed.assert_called_once()
            call_args = mock_embed.call_args[0][0]
            assert "标题" in call_args[0]
            assert "测试内容" in call_args[0]

    async def test_embedding_failure_still_loads(self):
        """Embedding 失败（返回 None）时记录仍可入库。"""
        records = [
            TransformedDocument(
                feishu_record_id="rec_001",
                owner_id="ou_abc",
                source_app_token="app1",
                source_table_id="tbl1",
                content_text="内容",
            ),
        ]
        transform_result = self._make_transform_result(records)
        mock_db = _make_mock_db()

        with patch(
            "app.services.llm.llm_client.batch_generate_embeddings",
            new_callable=AsyncMock,
            return_value=[None],  # Embedding 失败
        ):
            loader = AssetLoader()
            with patch.object(loader, "_update_sync_state", new_callable=AsyncMock):
                loaded = await loader.load(transform_result, mock_db)

        assert loaded == 1

    async def test_update_sync_state_success(self, db_session: AsyncSession):
        """加载后 sync_state 更新为 success。"""
        state = ETLSyncState(
            source_app_token="app1",
            source_table_id="tbl1",
            last_sync_status="running",
        )
        db_session.add(state)
        await db_session.commit()

        # mock 掉 db.execute 的部分调用：ETLDataSource 查询在 SQLite 中不存在
        original_execute = db_session.execute

        async def patched_execute(stmt, *args, **kwargs):
            # 检查 SQL 语句是否涉及 ETLDataSource（SQLite 没这个表）
            stmt_str = str(stmt)
            if "etl_data_sources" in stmt_str:
                mock_result = MagicMock()
                mock_result.scalar_one_or_none.return_value = None
                return mock_result
            return await original_execute(stmt, *args, **kwargs)

        with patch.object(db_session, "execute", side_effect=patched_execute):
            await AssetLoader._update_sync_state(db_session, "app1", "tbl1", 5)

        result = await db_session.execute(
            select(ETLSyncState).where(ETLSyncState.source_app_token == "app1")
        )
        updated = result.scalar_one()
        assert updated.last_sync_status == "success"
        assert updated.records_synced == 5
        assert updated.error_message is None


class TestDictToJson:
    def test_basic_dict(self):
        assert '"key"' in _dict_to_json({"key": "value"})

    def test_chinese_not_escaped(self):
        result = _dict_to_json({"名称": "测试"})
        assert "测试" in result
        assert "\\u" not in result
