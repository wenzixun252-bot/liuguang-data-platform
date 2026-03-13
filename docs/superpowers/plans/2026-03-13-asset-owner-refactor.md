# 资产所有人/上传人逻辑重塑 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 `uploader_name` → `asset_owner_name`（飞书资产所有人），删除 `uploaded_by`（与 owner_id 重复），清理 `_original_owner` workaround。

**Architecture:** 三个核心字段重新定义：
- `owner_id`（不改名）= 导入人/数据归属人 open_id，用于 RLS 权限控制
- `asset_owner_name`（原 `uploader_name` 改名）= 飞书文档/表格的原始所有者名字
- `uploaded_by` → 删除，上传人通过 `owner_id` 关联 User 表查名字

**Tech Stack:** Python/FastAPI, SQLAlchemy, Alembic, React/TypeScript

---

## Chunk 1: 数据库模型 + 迁移

### Task 1: 修改 ORM 模型

**Files:**
- Modify: `backend/app/models/document.py`
- Modify: `backend/app/models/communication.py`
- Modify: `backend/app/models/structured_table.py`

- [ ] **Step 1:** Document 模型：`uploader_name` → `asset_owner_name`，删除 `uploaded_by`，给 `owner_id` 加注释
- [ ] **Step 2:** Communication 模型：同上
- [ ] **Step 3:** StructuredTable 模型：删除 `uploaded_by`，加 `asset_owner_name`（当前缺失此字段）

### Task 2: 创建 Alembic 迁移

**Files:**
- Create: `backend/alembic/versions/xxxx_rename_uploader_name_to_asset_owner_name.py`

- [ ] **Step 1:** `alembic revision --autogenerate -m "rename uploader_name to asset_owner_name and drop uploaded_by"`
- [ ] **Step 2:** 检查生成的迁移脚本，确认 rename column + drop column 正确
- [ ] **Step 3:** `alembic upgrade head` 执行迁移

---

## Chunk 2: Schemas + ETL 管道

### Task 3: 修改 Pydantic Schemas

**Files:**
- Modify: `backend/app/schemas/document.py`
- Modify: `backend/app/schemas/communication.py`
- Modify: `backend/app/schemas/structured_table.py`

- [ ] **Step 1:** 所有 schema 中 `uploader_name` → `asset_owner_name`，删除 `uploaded_by`

### Task 4: 修改 ETL transformer dataclass

**Files:**
- Modify: `backend/app/services/etl/transformer.py`

- [ ] **Step 1:** `TransformedDocRecord` 和 `TransformedCommRecord`：`uploader_name` → `asset_owner_name`，删除 `uploaded_by`

### Task 5: 修改 ETL loader SQL

**Files:**
- Modify: `backend/app/services/etl/loader.py`

- [ ] **Step 1:** 文档 upsert SQL：列名改为 `asset_owner_name`，删除 `uploaded_by` 列引用
- [ ] **Step 2:** 沟通 upsert SQL：同上
- [ ] **Step 3:** `load()` 方法中原来按 owner_id 查 User 表设置 `uploader_name` 的逻辑保留，改为设置 `asset_owner_name`

---

## Chunk 3: 云文档导入服务（核心逻辑修复）

### Task 6: 重构 cloud_doc_import.py

**Files:**
- Modify: `backend/app/services/cloud_doc_import.py`

**关键逻辑变更：**
- 参数 `uploaded_by` → 删除（不再需要）
- 参数 `owner_display_name` → 含义不变，写入 `asset_owner_name`
- 删除所有 `_original_owner` workaround
- 新建记录时：`asset_owner_name = owner_display_name`（飞书原始所有者名字）
- 已存在记录回补时：只回补 `asset_owner_name`，不再回补 `_original_owner`

- [ ] **Step 1:** `import_cloud_doc()` — 删除 uploaded_by 参数和相关赋值，uploader_name → asset_owner_name，删除 _original_owner
- [ ] **Step 2:** `import_cloud_file()` — 同上
- [ ] **Step 3:** `import_item()` — 删除 uploaded_by 传递
- [ ] **Step 4:** `fast_import_item()` — 同上
- [ ] **Step 5:** `batch_import()` — 同上
- [ ] **Step 6:** `import_cloud_doc_as_communication()` — 同上
- [ ] **Step 7:** `import_file_as_communication()` — 同上
- [ ] **Step 8:** `batch_import_as_communication()` — 同上
- [ ] **Step 9:** `sync_folder()` — 同上

---

## Chunk 4: 飞书机器人服务（关键 bug 修复）

### Task 7: 重构 feishu_bot.py

**Files:**
- Modify: `backend/app/services/feishu_bot.py`

**关键 bug 修复：**
当前 bot 代码将 `owner_id` 设为文档实际所有者（actual_owner_id），但应该设为发消息的用户（聊天用户），因为 owner_id 用于 RLS 权限控制。

新逻辑：
- `owner_id` = 发消息的用户（user.feishu_open_id）— 始终不变
- `asset_owner_name` = 飞书文档实际所有者名字（从 `_resolve_doc_owner` 获取）
- 对于非飞书文档（纯文字/文件/网页），`asset_owner_name` = 发消息的用户名字

- [ ] **Step 1:** `_process_task()` 中：owner_id 始终用 user.feishu_open_id，`_resolve_doc_owner` 只用来获取 asset_owner_name
- [ ] **Step 2:** `_do_ingest()` 参数：`uploader_name` → `asset_owner_name`
- [ ] **Step 3:** `_ingest_text()` — uploader_name → asset_owner_name，删除 uploaded_by
- [ ] **Step 4:** `_ingest_file()` — 同上
- [ ] **Step 5:** `_ingest_cloud_doc()` — 同上
- [ ] **Step 6:** `_ingest_bitable()` — 同上
- [ ] **Step 7:** `_ingest_web_url()` — 同上
- [ ] **Step 8:** `_process_adjustment()` 中同样修正 owner_id 逻辑

---

## Chunk 5: 文件上传 + API 路由

### Task 8: 修改文件上传服务

**Files:**
- Modify: `backend/app/services/file_upload.py`

本地上传场景：asset_owner_name = 上传人自己（没有飞书所有者概念）

- [ ] **Step 1:** `process_upload()` 参数 `uploader_name` → `asset_owner_name`，赋值到 `asset_owner_name` 字段
- [ ] **Step 2:** `process_communication_upload()` 同上

### Task 9: 修改 upload.py API

**Files:**
- Modify: `backend/app/api/upload.py`

- [ ] **Step 1:** 删除 `doc.uploaded_by = current_user.name` 和 `comm.uploaded_by = current_user.name`，传参 `asset_owner_name=current_user.name`

### Task 10: 修改 documents.py API

**Files:**
- Modify: `backend/app/api/documents.py`

- [ ] **Step 1:** 查询参数 `uploader_name` → `asset_owner_name`
- [ ] **Step 2:** 搜索条件 `Document.uploader_name.ilike` → `Document.asset_owner_name.ilike`
- [ ] **Step 3:** 归档次数查询和搜索结果字段名更新
- [ ] **Step 4:** matched_fields 中更新字段名

### Task 11: 修改 communications.py API

**Files:**
- Modify: `backend/app/api/communications.py`

- [ ] **Step 1:** 搜索条件和响应字段 `uploader_name` → `asset_owner_name`

### Task 12: 修改 structured_tables.py API

**Files:**
- Modify: `backend/app/api/structured_tables.py`

- [ ] **Step 1:** 删除所有 `table.uploaded_by = current_user.name`
- [ ] **Step 2:** 查询参数和 LEFT JOIN 逻辑：uploader_name → asset_owner_name
- [ ] **Step 3:** 归档次数查询中删除 uploaded_by 引用
- [ ] **Step 4:** 响应构建中 uploader_name → asset_owner_name

### Task 13: 修改 data_import.py API

**Files:**
- Modify: `backend/app/api/data_import.py`

- [ ] **Step 1:** 所有 `uploaded_by=current_user.name` 或 `uploaded_by=actual_uploader` 参数删除

### Task 14: 修改 settings.py API

**Files:**
- Modify: `backend/app/api/settings.py`

- [ ] **Step 1:** 关键词同步调用中删除 uploaded_by / uploader_name 参数

---

## Chunk 6: Worker + 其他服务

### Task 15: 修改 worker/tasks.py

**Files:**
- Modify: `backend/app/worker/tasks.py`

- [ ] **Step 1:** ETL 同步中删除 uploaded_by 赋值逻辑（原来查 User 表设 uploaded_by 的代码块）
- [ ] **Step 2:** 文件夹同步中删除 uploader_name 查找和 uploaded_by 参数
- [ ] **Step 3:** 保留查 User 表的逻辑，但用于其他目的（如日志）或直接删除

### Task 16: 修改 worker/scheduler.py

**Files:**
- Modify: `backend/app/worker/scheduler.py`

- [ ] **Step 1:** 删除"查找登录用户名，用于标记 uploaded_by"相关代码

### Task 17: 修改 keyword_sync.py

**Files:**
- Modify: `backend/app/services/keyword_sync.py`

- [ ] **Step 1:** 删除 `uploader_name` 参数

### Task 18: 修改 rag.py

**Files:**
- Modify: `backend/app/services/rag.py`

- [ ] **Step 1:** 归档次数 SQL 中 `uploader_name` → `asset_owner_name`

---

## Chunk 7: 前端

### Task 19: 修改前端页面

**Files:**
- Modify: `frontend/src/pages/Documents.tsx`
- Modify: `frontend/src/pages/Communications.tsx`
- Modify: `frontend/src/pages/StructuredTables.tsx`
- Modify: `frontend/src/pages/KnowledgeGraph.tsx`

- [ ] **Step 1:** Documents.tsx — 类型定义和列配置：`uploader_name` → `asset_owner_name`，删除 `uploaded_by` 列
- [ ] **Step 2:** Communications.tsx — 类型定义：删除 `uploaded_by` 列（上传人列前端不再需要单独列，通过 owner_id 查 User 即可；或者保留列但从 API 获取）
- [ ] **Step 3:** StructuredTables.tsx — 同上
- [ ] **Step 4:** KnowledgeGraph.tsx — `uploader_name` → `asset_owner_name`

---

## 关于"上传人"前端展示的说明

删除 `uploaded_by` 后，前端"上传人"列的数据来源改为：后端 API 通过 `owner_id` LEFT JOIN User 表获取用户名，在响应中作为计算字段返回（类似 structured_tables.py 当前的做法）。
