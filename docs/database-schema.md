# 流光数据平台 — 核心数据表字段说明

> 生成日期：2026-03-04
> 数据库：PostgreSQL 16 + pgvector 扩展
> 连接方式：异步（SQLAlchemy 2.0 + asyncpg）
> 连接串：`postgresql+asyncpg://postgres:password@localhost:5432/liuguang`

---

## 调用须知

| 项目 | 说明 |
|------|------|
| **行级安全** | 所有查询必须按 `owner_id`（飞书 open_id）过滤，非管理员只能看到自己的数据 |
| **向量列** | `content_vector` 是 pgvector 的 1536 维向量，用于语义搜索，需要安装 pgvector 扩展 |
| **JSONB 字段** | `extra_fields`、`tags` 等使用 PostgreSQL 的 JSONB 类型，支持 GIN 索引查询 |
| **时间字段** | 所有 `created_at` / `updated_at` 为 UTC 时间戳，`updated_at` 会在每次更新时自动刷新 |

---

## 四张核心表总览

| 表名 | 用途 | 数据来源 |
|------|------|----------|
| `documents` | 文档（云文档、本地上传） | 飞书云文档 / 本地上传 |
| `meetings` | 会议记录 | 飞书多维表格同步 |
| `chat_messages` | 聊天消息 | 飞书多维表格同步 |
| `structured_tables` + `structured_table_rows` | 结构化表格数据 | 飞书多维表格 / 电子表格 / 本地 |

---

## 1. documents — 文档表

| 字段 | 类型 | 可空 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | int | NOT NULL | 自增 | 主键 |
| `owner_id` | varchar(64) | NOT NULL | — | 数据所有者（飞书 open_id） |
| `source_type` | varchar(16) | NOT NULL | — | 来源：`cloud`（云文档）/ `local`（本地上传） |
| `source_app_token` | varchar(128) | 可空 | — | 飞书多维表格 app token |
| `source_table_id` | varchar(128) | 可空 | — | 飞书多维表格 table id |
| `feishu_record_id` | varchar(128) | 可空 | — | 飞书记录 ID（非空时唯一） |
| `title` | varchar(512) | 可空 | — | 文档标题 |
| `content_text` | text | NOT NULL | — | 文档正文（纯文本） |
| `summary` | text | 可空 | — | AI 生成的摘要 |
| `author` | varchar(256) | 可空 | — | 作者 |
| `tags` | jsonb | NOT NULL | `{}` | 标签 |
| `category` | varchar(128) | 可空 | — | 分类 |
| `file_type` | varchar(64) | 可空 | — | 文件类型（如 pdf、docx） |
| `file_size` | int | 可空 | — | 文件大小（字节） |
| `file_path` | varchar(1024) | 可空 | — | 文件存储路径 |
| `doc_url` | varchar(1024) | 可空 | — | 文档在线链接 |
| `uploader_name` | varchar(256) | 可空 | — | 上传者姓名 |
| `content_vector` | vector(1536) | 可空 | — | 语义搜索用的 embedding 向量 |
| `extra_fields` | jsonb | NOT NULL | `{}` | 无法映射到固定列的额外数据 |
| `feishu_created_at` | timestamp | 可空 | — | 飞书端创建时间 |
| `feishu_updated_at` | timestamp | 可空 | — | 飞书端更新时间 |
| `synced_at` | timestamp | 可空 | — | 最后一次同步时间 |
| `created_at` | timestamp | NOT NULL | `now()` | 本地创建时间 |
| `updated_at` | timestamp | NOT NULL | `now()` | 本地更新时间 |

**索引**：owner_id、source_type、feishu_record_id（唯一）、tags（GIN）、extra_fields（GIN）

---

## 2. meetings — 会议表

| 字段 | 类型 | 可空 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | int | NOT NULL | 自增 | 主键 |
| `owner_id` | varchar(64) | NOT NULL | — | 数据所有者 |
| `source_app_token` | varchar(128) | NOT NULL | — | 飞书 app token |
| `source_table_id` | varchar(128) | 可空 | — | 飞书 table id |
| `feishu_record_id` | varchar(128) | NOT NULL | — | 飞书记录 ID（唯一） |
| `title` | varchar(512) | 可空 | — | 会议标题 |
| `meeting_time` | timestamp | 可空 | — | 会议时间 |
| `duration_minutes` | int | 可空 | — | 会议时长（分钟） |
| `location` | varchar(512) | 可空 | — | 会议地点 |
| `organizer` | varchar(256) | 可空 | — | 组织者 |
| `participants` | jsonb | NOT NULL | `[]` | 参会人列表，如 `["张三","李四"]` |
| `agenda` | text | 可空 | — | 会议议程 |
| `conclusions` | text | 可空 | — | 会议结论 |
| `action_items` | jsonb | NOT NULL | `[]` | 待办/行动项列表 |
| `content_text` | text | NOT NULL | — | 会议纪要全文 |
| `minutes_url` | varchar(1024) | 可空 | — | 会议纪要在线链接 |
| `uploader_name` | varchar(256) | 可空 | — | 上传者姓名 |
| `content_vector` | vector(1536) | 可空 | — | 语义搜索用的 embedding 向量 |
| `extra_fields` | jsonb | NOT NULL | `{}` | 额外数据 |
| `feishu_created_at` | timestamp | 可空 | — | 飞书端创建时间 |
| `feishu_updated_at` | timestamp | 可空 | — | 飞书端更新时间 |
| `synced_at` | timestamp | 可空 | — | 最后一次同步时间 |
| `created_at` | timestamp | NOT NULL | `now()` | 本地创建时间 |
| `updated_at` | timestamp | NOT NULL | `now()` | 本地更新时间 |

**索引**：owner_id、meeting_time

---

## 3. chat_messages — 聊天消息表

| 字段 | 类型 | 可空 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | int | NOT NULL | 自增 | 主键 |
| `owner_id` | varchar(64) | NOT NULL | — | 数据所有者 |
| `source_app_token` | varchar(128) | NOT NULL | — | 飞书 app token |
| `source_table_id` | varchar(128) | 可空 | — | 飞书 table id |
| `feishu_record_id` | varchar(128) | NOT NULL | — | 飞书记录 ID（唯一） |
| `chat_id` | varchar(256) | 可空 | — | 聊天会话 ID（同一群/对话的消息共享同一个 chat_id） |
| `sender` | varchar(256) | 可空 | — | 发送者姓名 |
| `message_type` | varchar(64) | 可空 | — | 消息类型（如 text、image 等） |
| `content_text` | text | NOT NULL | — | 消息正文 |
| `sent_at` | timestamp | 可空 | — | 发送时间 |
| `reply_to` | varchar(128) | 可空 | — | 回复的消息 ID |
| `mentions` | jsonb | NOT NULL | `[]` | 被 @ 的人列表 |
| `uploader_name` | varchar(256) | 可空 | — | 上传者姓名 |
| `content_vector` | vector(1536) | 可空 | — | 语义搜索用的 embedding 向量 |
| `extra_fields` | jsonb | NOT NULL | `{}` | 额外数据 |
| `synced_at` | timestamp | 可空 | — | 最后一次同步时间 |
| `created_at` | timestamp | NOT NULL | `now()` | 本地创建时间 |
| `updated_at` | timestamp | NOT NULL | `now()` | 本地更新时间 |

**索引**：owner_id、chat_id、sent_at

---

## 4. structured_tables + structured_table_rows — 结构化表格

这是一对多关系：一个 `structured_tables` 记录（表的元信息）对应多条 `structured_table_rows`（每一行的数据）。

### 4a. structured_tables（表级元数据）

| 字段 | 类型 | 可空 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | int | NOT NULL | 自增 | 主键 |
| `owner_id` | varchar(64) | NOT NULL | — | 数据所有者 |
| `name` | varchar(512) | NOT NULL | — | 表名 |
| `description` | text | 可空 | — | 表的描述 |
| `summary` | text | 可空 | — | AI 生成的表摘要 |
| `source_type` | varchar(32) | NOT NULL | — | 来源：`bitable`（多维表格）/ `spreadsheet`（电子表格）/ `local`（本地） |
| `source_app_token` | varchar(128) | 可空 | — | 飞书 app token |
| `source_table_id` | varchar(128) | 可空 | — | 飞书 table id |
| `source_url` | varchar(1024) | 可空 | — | 来源链接 |
| `file_name` | varchar(512) | 可空 | — | 原始文件名 |
| `schema_info` | jsonb | 可空 | — | 表结构信息（列名、列类型等） |
| `row_count` | int | NOT NULL | 0 | 总行数 |
| `column_count` | int | NOT NULL | 0 | 总列数 |
| `synced_at` | timestamp | 可空 | — | 最后一次同步时间 |
| `created_at` | timestamp | NOT NULL | `now()` | 本地创建时间 |
| `updated_at` | timestamp | NOT NULL | `now()` | 本地更新时间 |

**唯一约束**：`(owner_id, source_app_token, source_table_id)`
**索引**：owner_id、source_type

### 4b. structured_table_rows（行级数据）

| 字段 | 类型 | 可空 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | int | NOT NULL | 自增 | 主键 |
| `table_id` | int | NOT NULL | — | 所属表 ID（外键 → structured_tables.id，删除时级联删除） |
| `row_index` | int | NOT NULL | — | 行号（从 0 开始） |
| `row_data` | jsonb | NOT NULL | `{}` | 该行的完整数据，格式为 `{"列名": "值", ...}` |
| `row_text` | text | 可空 | — | 该行拼接成的纯文本（用于全文搜索） |
| `created_at` | timestamp | NOT NULL | `now()` | 创建时间 |

**索引**：table_id

---

## 公共字段速查

| 字段 | 说明 |
|------|------|
| `owner_id` | 所有表都有，是飞书 open_id（varchar(64)），查询时**必须**带上这个条件做权限过滤 |
| `content_vector` | 文档/会议/聊天三张表有，1536 维向量，用于"以文搜文"的语义检索 |
| `content_text` | 文档/会议/聊天三张表有，是核心正文内容，全文搜索的主要目标 |
| `extra_fields` | 文档/会议/聊天三张表有，JSONB 格式，存放无法映射到固定列的数据 |
| `feishu_record_id` | 文档/会议/聊天三张表有，飞书多维表格的记录 ID，用于增量同步去重 |
