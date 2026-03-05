"""change_feishu_rid_index_to_per_user

将 documents.feishu_record_id 的全局唯一约束改为 (feishu_record_id, owner_id) 联合唯一，
允许不同用户各自导入同一飞书文档，RAG 检索时按 feishu_record_id 去重。

Revision ID: p6f7g8h9i0j1
Revises: o5e6f7g8h9i0
Create Date: 2026-03-05 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'p6f7g8h9i0j1'
down_revision: Union[str, None] = 'o5e6f7g8h9i0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 先删除旧的全局唯一索引
    op.drop_index('idx_doc_feishu_rid', table_name='documents')
    # 创建新的 (feishu_record_id, owner_id) 联合唯一索引
    op.create_index(
        'idx_doc_feishu_rid',
        'documents',
        ['feishu_record_id', 'owner_id'],
        unique=True,
        postgresql_where="feishu_record_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_index('idx_doc_feishu_rid', table_name='documents')
    op.create_index(
        'idx_doc_feishu_rid',
        'documents',
        ['feishu_record_id'],
        unique=True,
        postgresql_where="feishu_record_id IS NOT NULL",
    )
