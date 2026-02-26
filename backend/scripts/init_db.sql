-- ============================================================
-- 流光智能数据资产平台 — 核心 DDL
-- 在 PostgreSQL 中手动执行此脚本完成初始化
-- 也可通过 Alembic 自动迁移 (推荐)
-- ============================================================

-- 0. 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    feishu_open_id  VARCHAR(64)  NOT NULL UNIQUE,
    feishu_union_id VARCHAR(64),
    name            VARCHAR(128) NOT NULL,
    avatar_url      VARCHAR(1024),
    email           VARCHAR(256),
    role            VARCHAR(16)  NOT NULL DEFAULT 'employee'
                    CONSTRAINT ck_users_role CHECK (role IN ('employee', 'executive', 'admin')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. 统一数据资产表
CREATE TABLE IF NOT EXISTS data_assets (
    feishu_record_id   VARCHAR(128) PRIMARY KEY,
    owner_id           VARCHAR(64)  NOT NULL,
    source_app_token   VARCHAR(128) NOT NULL,
    source_table_id    VARCHAR(128),
    asset_type         VARCHAR(32)  NOT NULL DEFAULT 'conversation'
                       CONSTRAINT ck_data_assets_type CHECK (asset_type IN ('conversation', 'meeting_note', 'document', 'other')),
    title              VARCHAR(512),
    content_text       TEXT         NOT NULL,
    content_vector     vector(1536),
    asset_tags         JSONB        NOT NULL DEFAULT '{}',
    feishu_created_at  TIMESTAMPTZ,
    feishu_updated_at  TIMESTAMPTZ,
    synced_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_owner  ON data_assets(owner_id);
CREATE INDEX IF NOT EXISTS idx_assets_type   ON data_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_tags   ON data_assets USING gin (asset_tags);
-- 注意: ivfflat 索引需要表中有数据后再创建, 否则效果不佳
-- CREATE INDEX IF NOT EXISTS idx_assets_vector ON data_assets USING ivfflat (content_vector vector_cosine_ops) WITH (lists = 100);

-- 3. ETL 同步状态表
CREATE TABLE IF NOT EXISTS etl_sync_state (
    id                SERIAL PRIMARY KEY,
    source_app_token  VARCHAR(128) NOT NULL,
    source_table_id   VARCHAR(128) NOT NULL,
    last_sync_time    TIMESTAMPTZ  NOT NULL DEFAULT '1970-01-01T00:00:00+00:00',
    last_sync_status  VARCHAR(16)  NOT NULL DEFAULT 'idle'
                      CONSTRAINT ck_etl_sync_status CHECK (last_sync_status IN ('idle', 'running', 'success', 'failed')),
    records_synced    INTEGER      DEFAULT 0,
    error_message     TEXT,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_etl_sync_source UNIQUE (source_app_token, source_table_id)
);

-- 4. Schema 映射缓存表
CREATE TABLE IF NOT EXISTS schema_mapping_cache (
    id                SERIAL PRIMARY KEY,
    source_app_token  VARCHAR(128) NOT NULL,
    source_table_id   VARCHAR(128) NOT NULL,
    schema_md5        VARCHAR(32)  NOT NULL,
    mapping_result    JSONB        NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_schema_cache UNIQUE (source_app_token, source_table_id, schema_md5)
);
