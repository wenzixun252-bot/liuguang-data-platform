-- 流光智能数据资产平台 — 数据库初始化脚本
-- 此脚本由 PostgreSQL Docker 容器在首次启动时自动执行

-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 注意: 表结构由 Alembic 迁移管理，此处仅做扩展初始化
-- 运行 `alembic upgrade head` 创建所有表
