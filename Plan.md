# 飞书企业级 ETL 与"流光"智能数据资产平台 — 开发计划

---

## 阶段总览

| 阶段 | 名称 | 前置依赖 |
|------|------|----------|
| P0 | 工程骨架与数据库底座 | 无 |
| P1 | 飞书 SSO 鉴权与 RBAC 权限模块 | P0 |
| P2 | ETL 引擎 — 数据抓取与增量同步 (Extract) | P0, P1 |
| P3 | LLM 动态清洗与资产入库 (Transform + Load) | P2 |
| P4 | "流光"智能助手 — 权限感知 RAG 检索与问答 | P1, P3 |
| P5 | 前端数据看板与交互界面 | P1, P4 |
| P6 | 集成测试、部署与上线收尾 | P0-P5 |

---

## P0 — 工程骨架与数据库底座

### 目标
搭建全栈工程目录结构、配置管理体系、数据库连接池与核心表 DDL，使后续所有模块可以在统一骨架上独立并行开发。

### 任务清单

#### P0-1: 初始化工程目录结构
- 创建 FastAPI 后端项目骨架：
  ```
  backend/
  ├── app/
  │   ├── __init__.py
  │   ├── main.py              # FastAPI 入口, CORS, lifespan
  │   ├── config.py            # Pydantic Settings 统一配置
  │   ├── database.py          # 异步 SQLAlchemy 引擎 & Session
  │   ├── models/              # ORM 模型
  │   │   ├── __init__.py
  │   │   ├── user.py
  │   │   └── asset.py
  │   ├── schemas/             # Pydantic 请求/响应模型
  │   │   ├── __init__.py
  │   │   ├── user.py
  │   │   └── asset.py
  │   ├── api/                 # 路由层
  │   │   ├── __init__.py
  │   │   ├── deps.py          # 公共依赖 (get_db, get_current_user)
  │   │   ├── auth.py
  │   │   ├── assets.py
  │   │   └── chat.py
  │   ├── services/            # 业务逻辑层
  │   │   ├── __init__.py
  │   │   ├── feishu.py        # 飞书 API 封装
  │   │   ├── etl/
  │   │   │   ├── __init__.py
  │   │   │   ├── extractor.py
  │   │   │   ├── transformer.py
  │   │   │   └── loader.py
  │   │   ├── llm.py           # 大模型调用封装
  │   │   └── rag.py           # RAG 检索逻辑
  │   ├── worker/              # 后台任务 Worker
  │   │   ├── __init__.py
  │   │   ├── scheduler.py     # APScheduler 调度器
  │   │   └── tasks.py         # ETL 定时任务定义
  │   └── utils/
  │       ├── __init__.py
  │       ├── security.py      # JWT 签发/验证
  │       └── feishu_webhook.py # 飞书 Webhook 告警
  ├── alembic/                 # 数据库迁移
  │   └── versions/
  ├── alembic.ini
  ├── requirements.txt
  ├── .env.example
  └── Dockerfile
  ```
- 创建前端项目占位目录 `frontend/`（P5 阶段填充）

#### P0-2: 依赖管理与配置体系
- 编写 `requirements.txt`，锁定核心依赖版本：
  - `fastapi`, `uvicorn[standard]`, `sqlalchemy[asyncio]`, `asyncpg`
  - `alembic`, `pydantic-settings`, `python-jose[cryptography]`, `passlib`
  - `httpx` (异步 HTTP 客户端，调飞书/LLM API)
  - `apscheduler`, `pgvector`, `larksuite-oapi`
  - `openai` (兼容 DeepSeek/Qwen 的 OpenAI 格式 SDK)
- 编写 `app/config.py`：用 `pydantic-settings` 从 `.env` 读取所有配置项
  - `DATABASE_URL`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`
  - `JWT_SECRET_KEY`, `JWT_ALGORITHM`, `JWT_EXPIRE_MINUTES`
  - `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`
  - `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`
  - `FEISHU_WEBHOOK_URL` (告警 Webhook 地址)
  - `ETL_REGISTRY_APP_TOKEN`, `ETL_REGISTRY_TABLE_ID` (注册中心表地址)
- 编写 `.env.example` 模板文件

#### P0-3: 数据库连接与 ORM 基础设施
- `app/database.py`：配置异步 SQLAlchemy engine (`create_async_engine`) + `async_sessionmaker`
- 配置 Alembic 支持异步迁移 (`alembic/env.py` 使用 `run_async`)
- 在 `app/main.py` 的 `lifespan` 中完成引擎创建与关闭

#### P0-4: 核心 DDL — Users 表
```sql
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    feishu_open_id  VARCHAR(64)  NOT NULL UNIQUE,
    feishu_union_id VARCHAR(64),
    name            VARCHAR(128) NOT NULL,
    avatar_url      TEXT,
    email           VARCHAR(256),
    role            VARCHAR(16)  NOT NULL DEFAULT 'employee'
                    CHECK (role IN ('employee', 'executive', 'admin')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users(role);
```

#### P0-5: 核心 DDL — 统一数据资产表
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE data_assets (
    feishu_record_id   VARCHAR(128) PRIMARY KEY,
    owner_id           VARCHAR(64)  NOT NULL REFERENCES users(feishu_open_id),
    source_app_token   VARCHAR(128) NOT NULL,
    source_table_id    VARCHAR(128),
    asset_type         VARCHAR(32)  NOT NULL DEFAULT 'conversation'
                       CHECK (asset_type IN ('conversation', 'meeting_note', 'document', 'other')),
    title              VARCHAR(512),
    content_text       TEXT         NOT NULL,
    content_vector     vector(1536),
    asset_tags         JSONB        DEFAULT '{}',
    feishu_created_at  TIMESTAMPTZ,
    feishu_updated_at  TIMESTAMPTZ,
    synced_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_owner    ON data_assets(owner_id);
CREATE INDEX idx_assets_type     ON data_assets(asset_type);
CREATE INDEX idx_assets_vector   ON data_assets USING ivfflat (content_vector vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_assets_tags     ON data_assets USING gin (asset_tags);
```

#### P0-6: 核心 DDL — ETL 同步状态表
```sql
CREATE TABLE etl_sync_state (
    id                SERIAL PRIMARY KEY,
    source_app_token  VARCHAR(128) NOT NULL,
    source_table_id   VARCHAR(128) NOT NULL,
    last_sync_time    TIMESTAMPTZ  NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    last_sync_status  VARCHAR(16)  NOT NULL DEFAULT 'idle'
                      CHECK (last_sync_status IN ('idle', 'running', 'success', 'failed')),
    records_synced    INTEGER      DEFAULT 0,
    error_message     TEXT,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (source_app_token, source_table_id)
);
```

#### P0-7: 核心 DDL — Schema 映射缓存表
```sql
CREATE TABLE schema_mapping_cache (
    id                SERIAL PRIMARY KEY,
    source_app_token  VARCHAR(128) NOT NULL,
    source_table_id   VARCHAR(128) NOT NULL,
    schema_md5        VARCHAR(32)  NOT NULL,
    mapping_result    JSONB        NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (source_app_token, source_table_id, schema_md5)
);
```

#### P0-8: 编写 SQLAlchemy ORM 模型
- `models/user.py` — 映射 `users` 表
- `models/asset.py` — 映射 `data_assets`, `etl_sync_state`, `schema_mapping_cache` 表
- 使用 `pgvector.sqlalchemy.Vector` 类型声明向量列

#### P0-9: 生成首个 Alembic 迁移并验证
- `alembic revision --autogenerate -m "init tables"`
- `alembic upgrade head`
- 验证所有表、索引、约束均正确创建

#### P0-10: FastAPI 启动验证
- `app/main.py` 配置 CORS、注册 lifespan、挂载空路由
- 编写 `GET /health` 接口，返回数据库连通状态
- `uvicorn app.main:app --reload` 启动验证

### 验收标准
- [ ] `uvicorn` 启动无报错，`GET /health` 返回 `{"status": "ok", "db": "connected"}`
- [ ] 数据库中 `users`, `data_assets`, `etl_sync_state`, `schema_mapping_cache` 四张表均已创建
- [ ] `pgvector` 扩展已启用，`content_vector` 列类型为 `vector(1536)`
- [ ] Alembic 迁移版本链完整，`alembic current` 显示最新版本
- [ ] `.env.example` 包含所有必要配置项且有注释说明

---

## P1 — 飞书 SSO 鉴权与 RBAC 权限模块

### 目标
实现完整的飞书 OAuth 2.0 免登流程，签发应用内 JWT，建立基于角色的访问控制体系，使后续所有接口可复用 `get_current_user` 依赖注入。

### 任务清单

#### P1-1: 飞书 OAuth 2.0 后端实现
- `services/feishu.py` 封装飞书 API 调用类 `FeishuClient`：
  - `get_app_access_token()` — 获取应用凭证 (app_access_token)
  - `get_tenant_access_token()` — 获取企业凭证 (tenant_access_token)
  - `get_user_info_by_code(code: str)` — 用临时授权码换取 user_access_token，再获取用户信息 (open_id, union_id, name, avatar_url, email)
- 所有 HTTP 请求使用 `httpx.AsyncClient`，统一处理错误与重试

#### P1-2: JWT 签发与验证工具
- `utils/security.py`：
  - `create_access_token(data: dict) -> str` — 签发 JWT，payload 包含 `sub` (feishu_open_id), `role`, `exp`
  - `decode_access_token(token: str) -> dict` — 验证并解码 JWT
- 使用 `python-jose` 库，算法 HS256

#### P1-3: 登录接口
- `api/auth.py`:
  - `POST /api/auth/feishu/callback` — 接收前端传来的 `code`，调用飞书换取用户信息，Upsert 到 `users` 表，签发 JWT 返回
  - 响应体: `{ "access_token": "...", "token_type": "bearer", "user": { ... } }`

#### P1-4: 公共依赖注入
- `api/deps.py`:
  - `get_db()` — 异步数据库 Session 生成器
  - `get_current_user(token)` — 从 `Authorization: Bearer <token>` 中解码 JWT，查询数据库返回 User ORM 对象；token 无效或过期返回 401
  - `require_role(roles: list)` — 角色校验依赖，非指定角色返回 403

#### P1-5: 用户信息接口
- `GET /api/users/me` — 返回当前登录用户信息
- `GET /api/users` — 仅 admin 角色可访问，返回所有用户列表
- `PATCH /api/users/{feishu_open_id}/role` — 仅 admin 可修改用户角色

#### P1-6: 单元测试 — 鉴权模块
- 测试 JWT 签发/验证的正确性与过期处理
- 测试 `get_current_user` 依赖在 token 无效时返回 401
- 测试 `require_role` 在角色不符时返回 403
- Mock 飞书 API 响应，测试 OAuth 回调流程

### 验收标准
- [ ] 使用 Mock 飞书授权码调用 `POST /api/auth/feishu/callback` 能成功返回 JWT
- [ ] 携带合法 JWT 访问 `GET /api/users/me` 返回正确用户信息
- [ ] 使用 employee 角色 JWT 访问 admin 接口返回 403
- [ ] 无 token / 过期 token 访问受保护接口返回 401
- [ ] 飞书 API 调用失败时返回明确的错误信息而非 500
- [ ] 所有鉴权相关单元测试通过 (`pytest tests/test_auth.py`)

---

## P2 — ETL 引擎 — 数据抓取与增量同步 (Extract)

### 目标
实现从飞书多维表格的增量数据抓取能力，包括注册中心寻址、增量拉取、频次控制与同步状态管理。

### 任务清单

#### P2-1: 飞书多维表格 API 封装
- 在 `services/feishu.py` 中扩展：
  - `list_bitable_records(app_token, table_id, filter=None, page_token=None, page_size=100)` — 分页读取多维表格记录
  - `get_bitable_fields(app_token, table_id)` — 获取表的字段 Schema 定义
  - `get_bitable_tables(app_token)` — 获取应用下的所有表列表
- 使用 `tenant_access_token` 鉴权
- 内置请求频次控制：QPS ≤ 5，避免触发飞书限流

#### P2-2: 注册中心读取
- `services/etl/extractor.py` 实现 `RegistryReader`:
  - 读取 `ETL_REGISTRY_APP_TOKEN` + `ETL_REGISTRY_TABLE_ID` 配置的注册中心表
  - 解析每行记录获得目标表信息：`app_token`, `table_id`, `table_name`, `asset_type`, `is_enabled`
  - 仅返回 `is_enabled = True` 的记录

#### P2-3: 增量拉取引擎
- `services/etl/extractor.py` 实现 `IncrementalExtractor`:
  - 读取 `etl_sync_state` 表获取该表的 `last_sync_time`
  - 构建飞书过滤条件：`update_time > last_sync_time`
  - 分页抓取所有增量记录
  - 更新 `etl_sync_state` 表状态为 `running`
  - 返回原始记录列表 + 源表 Schema

#### P2-4: 飞书 Webhook 告警工具
- `utils/feishu_webhook.py`:
  - `send_alert(title, content, error_link=None)` — 构建飞书消息卡片 JSON，通过 Webhook URL 发送
  - 封装卡片模板：包含告警标题、错误详情、源表链接

#### P2-5: APScheduler 调度器集成
- `worker/scheduler.py`:
  - 初始化 `AsyncIOScheduler`
  - 在 FastAPI `lifespan` 中启动/关闭调度器
- `worker/tasks.py`:
  - `etl_sync_job()` — 定时任务入口：遍历注册中心 → 逐表增量抓取 → 触发 Transform + Load
  - 默认 cron：每 30 分钟执行一次，可通过配置调整

#### P2-6: ETL 管理接口
- `api/assets.py` (admin 权限):
  - `GET /api/etl/status` — 查看所有同步状态
  - `POST /api/etl/trigger` — 手动触发一次全量 ETL 同步
  - `GET /api/etl/registry` — 查看注册中心内容

#### P2-7: 单元测试 — Extract 模块
- Mock 飞书多维表格 API 响应
- 测试增量拉取逻辑：仅返回 `update_time > last_sync_time` 的记录
- 测试注册中心解析正确性
- 测试频次控制：并发调用不超过 QPS 限制
- 测试同步状态更新

### 验收标准
- [ ] 手动调用 `POST /api/etl/trigger` 能成功从飞书多维表格抓取数据（使用测试表验证）
- [ ] 增量拉取仅返回上次同步后的新增/修改记录
- [ ] `etl_sync_state` 表正确记录每次同步的状态、时间、记录数
- [ ] 飞书 API 调用异常时，Webhook 告警成功发送到群聊
- [ ] APScheduler 定时任务按预期间隔触发
- [ ] `GET /api/etl/status` 正确返回各表同步状态
- [ ] Extract 模块单元测试全部通过

---

## P3 — LLM 动态清洗与资产入库 (Transform + Load)

### 目标
实现 Schema 语义映射（LLM 驱动）、映射缓存、异构数据处理、Embedding 生成与 Upsert 入库的完整 Transform + Load 链路。

### 任务清单

#### P3-1: LLM 调用封装
- `services/llm.py`:
  - `LLMClient` 类，封装对 DeepSeek/Qwen 的调用（兼容 OpenAI 格式）
  - `schema_mapping(source_schema, target_schema) -> dict` — 将源表 Schema 与目标标准 Schema 传入 LLM，返回字段映射字典
  - `generate_embedding(text: str) -> list[float]` — 调用 Embedding 模型生成向量
  - `batch_generate_embeddings(texts: list[str]) -> list[list[float]]` — 批量生成向量
  - 统一错误处理与重试机制（指数退避，最多 3 次）

#### P3-2: Schema 映射 Prompt 工程
- 定义目标标准 Schema 常量（字段名 + 语义描述）：
  ```
  feishu_record_id: 记录唯一标识
  owner_id: 数据归属人的飞书 open_id
  title: 记录标题/主题
  content_text: 记录正文/核心内容
  asset_type: 资产类型
  feishu_created_at: 飞书端创建时间
  feishu_updated_at: 飞书端更新时间
  ```
- 构建 Prompt 模板：输入源 Schema + 目标 Schema，要求 LLM 输出 JSON 格式的映射关系
- 对 LLM 输出做 JSON 解析与校验，解析失败时重试

#### P3-3: Schema 映射缓存机制
- `services/etl/transformer.py`:
  - 抓取源表 Schema 后，计算其 MD5 哈希
  - 先查询 `schema_mapping_cache` 表：命中则直接使用缓存映射
  - 未命中则调用 LLM 获取映射，存入缓存表
  - 严禁对相同 Schema 重复调用 LLM

#### P3-4: 数据转换引擎
- `services/etl/transformer.py` 实现 `DataTransformer`:
  - 接收原始记录列表 + 字段映射字典
  - 按映射规则将源字段转换为标准字段
  - 无法映射的字段统一打包进 `asset_tags` (JSONB)
  - 处理时间格式统一化（飞书时间戳 → ISO 8601）
  - 生成 `content_text`（拼接核心文本内容）

#### P3-5: 异常数据处理与告警
- 关键字段缺失（`feishu_record_id`, `owner_id`, `content_text`）时：
  - 丢弃该条记录
  - 记录到本地日志 (`logging.warning`)
  - 通过飞书 Webhook 发送告警卡片，包含错误链接和失败原因
- LLM 映射彻底失败（3 次重试后仍无法解析）时：
  - 跳过该表的本轮同步
  - 发送告警并更新 `etl_sync_state` 为 `failed`

#### P3-6: Embedding 向量生成
- 对每条清洗后的记录，将 `title + content_text` 拼接后调用 Embedding 模型
- 批量处理：每批最多 20 条，控制 API 调用频率
- Embedding 失败时记录日志，该记录的 `content_vector` 置 NULL（不阻塞入库）

#### P3-7: 数据加载器 (Loader)
- `services/etl/loader.py` 实现 `AssetLoader`:
  - 接收转换后的标准记录列表
  - 使用异步 SQLAlchemy 批量执行 Upsert：
    ```sql
    INSERT INTO data_assets (...) VALUES (...)
    ON CONFLICT (feishu_record_id) DO UPDATE SET
      content_text = EXCLUDED.content_text,
      content_vector = EXCLUDED.content_vector,
      asset_tags = EXCLUDED.asset_tags,
      feishu_updated_at = EXCLUDED.feishu_updated_at,
      updated_at = now()
    ```
  - 事务提交成功后更新 `etl_sync_state` 为 `success`，记录 `records_synced`

#### P3-8: ETL 全链路串联
- `worker/tasks.py` 中的 `etl_sync_job()` 完整串联：
  1. `RegistryReader.read()` — 获取注册列表
  2. 遍历每个目标表：
     a. `IncrementalExtractor.extract()` — 增量抓取
     b. `DataTransformer.transform()` — Schema 映射 + 数据清洗
     c. `AssetLoader.load()` — Upsert 入库
  3. 汇总本轮统计信息

#### P3-9: 单元测试 — Transform + Load 模块
- Mock LLM API 响应，测试 Schema 映射解析
- 测试缓存命中：相同 Schema 不重复调用 LLM
- 测试异构字段正确打包进 `asset_tags`
- 测试关键字段缺失时的丢弃与告警逻辑
- 测试 Upsert 逻辑：重复 record_id 更新而非插入
- 测试 Embedding 批量生成与失败容错

### 验收标准
- [ ] 端到端 ETL 链路可运行：从飞书抓取 → LLM 映射 → 清洗 → 生成向量 → 入库
- [ ] `schema_mapping_cache` 表中缓存了映射结果，相同 Schema 不重复调用 LLM
- [ ] 无法映射的字段正确存储在 `asset_tags` JSONB 字段中
- [ ] 关键字段缺失的记录被丢弃，飞书群收到告警消息
- [ ] `data_assets` 表中数据已入库，`content_vector` 非空
- [ ] 重复执行 ETL 不产生重复记录（Upsert 验证）
- [ ] `etl_sync_state` 正确反映每次同步结果
- [ ] Transform + Load 模块单元测试全部通过

---

## P4 — "流光"智能助手 — 权限感知 RAG 检索与问答

### 目标
构建权限感知的混合检索引擎（Vector + BM25），实现"流光"智能体的流式问答接口，确保数据零越权。

### 任务清单

#### P4-1: 权限感知的向量检索
- `services/rag.py` 实现 `VectorSearcher`:
  - 输入：`query_text`, `user_open_id`, `user_role`, `top_k`
  - 调用 Embedding 模型将 query 转为向量
  - 构建 SQL：
    ```sql
    SELECT *, content_vector <=> :query_vector AS distance
    FROM data_assets
    WHERE (:is_admin OR owner_id = :user_open_id)
    ORDER BY distance ASC
    LIMIT :top_k
    ```
  - 普通员工强制附加 `owner_id` 过滤；admin/executive 可查全部

#### P4-2: BM25 关键词检索
- 在 PostgreSQL 中配置全文检索：
  - 为 `data_assets` 添加 `ts_vector` 列（`tsvector` 类型）
  - 创建 GIN 索引
  - 编写触发器：在 INSERT/UPDATE 时自动更新 `ts_vector`
- `services/rag.py` 实现 `BM25Searcher`:
  - 使用 `ts_rank_cd` 进行 BM25 排序
  - 同样附加 `owner_id` 权限过滤

#### P4-3: 混合检索融合
- `services/rag.py` 实现 `HybridSearcher`:
  - 同时执行向量检索和 BM25 检索
  - 使用 Reciprocal Rank Fusion (RRF) 合并两路结果
  - 去重（基于 `feishu_record_id`）
  - 返回最终 top_k 条上下文

#### P4-4: "流光"问答接口 — 流式输出
- `api/chat.py`:
  - `POST /api/chat/stream` — SSE 流式问答接口
  - 请求体: `{ "question": "...", "history": [...] }`
  - 处理流程：
    1. 从 JWT 获取当前用户信息
    2. 调用 `HybridSearcher` 获取权限过滤后的上下文
    3. 构建 System Prompt + 检索上下文 + 用户问题
    4. 调用 LLM API（stream=True），逐 chunk 通过 SSE 推送给前端
  - 返回格式：`text/event-stream`

#### P4-5: "流光"问答接口 — 非流式
- `POST /api/chat/ask` — 普通 JSON 问答接口（用于调试/简单场景）
- 返回完整回答 + 引用的数据来源（`feishu_record_id` 列表）

#### P4-6: RAG 上下文构建 Prompt 工程
- 设计 System Prompt 模板：
  - 角色定义："你是流光办公助手，基于员工的数据资产回答问题"
  - 上下文注入格式
  - 回答要求：引用出处、不编造信息、超出数据范围时明确告知
- 在 config 中配置 System Prompt 模板，便于调优

#### P4-7: 对话历史管理
- 支持前端传入 `history` 数组（最近 N 轮对话）
- 后端截断策略：保留最近 10 轮，总 token 不超过配置上限
- 不做服务端持久化（V1 版本前端管理即可）

#### P4-8: 单元测试 — RAG 模块
- 测试权限过滤：employee 用户检索仅返回自己的数据
- 测试 admin 用户可检索全部数据
- 测试混合检索 RRF 合并逻辑
- 测试流式输出的 SSE 格式正确性
- Mock LLM API，测试上下文注入与 Prompt 构建

### 验收标准
- [ ] employee 用户通过 `/api/chat/stream` 提问，仅基于自己的数据生成回答
- [ ] admin 用户提问可基于全局数据生成回答
- [ ] 流式接口正确输出 SSE 格式，前端可逐字接收
- [ ] 非流式接口返回完整回答 + 引用来源
- [ ] 向量检索和关键词检索均生效，混合排序合理
- [ ] 空检索结果时 LLM 明确告知"未找到相关数据"
- [ ] RAG 模块单元测试全部通过

---

## P5 — 前端数据看板与交互界面

### 目标
构建前端 SPA 应用，包括飞书登录、个人数据看板、ETL 管理面板、"流光"智能问答对话界面。

### 任务清单

#### P5-1: 前端工程初始化
- 技术选型：React + TypeScript + Vite + Tailwind CSS
- 初始化项目：`frontend/`
- 安装核心依赖：`axios`, `react-router-dom`, `@tanstack/react-query`
- 配置代理：Vite dev server 代理 `/api` 到后端

#### P5-2: 飞书登录页
- `/login` 路由
- 引导用户跳转飞书 OAuth 授权页面
- 回调处理：获取 `code`，调用 `POST /api/auth/feishu/callback`，存储 JWT 到 localStorage
- 登录成功后跳转到看板首页

#### P5-3: 全局布局与路由守卫
- 侧边栏导航：看板首页、数据资产、流光助手、ETL 管理（admin 才显示）
- 顶栏：用户头像、名称、角色、退出登录
- 路由守卫：未登录重定向到 `/login`，角色不足重定向到 403 页

#### P5-4: 个人数据看板
- `/dashboard` 路由
- 展示当前用户的数据资产统计：
  - 资产总数、各类型分布（饼图）
  - 最近同步的资产列表（表格，支持分页）
  - 时间趋势图（最近 30 天新增资产折线图）
- 调用接口：`GET /api/assets/stats`、`GET /api/assets/list`

#### P5-5: 数据资产列表与详情
- `/assets` 路由
- 资产列表：表格展示，支持搜索、筛选（类型/时间）、分页
- 资产详情：点击记录展开详情面板，显示完整内容、标签、来源
- 调用接口：`GET /api/assets/list`、`GET /api/assets/{record_id}`

#### P5-6: 后端补充 — 看板数据接口
- `api/assets.py`:
  - `GET /api/assets/stats` — 返回当前用户的资产统计（数量、类型分布、趋势）
  - `GET /api/assets/list` — 分页查询资产列表（支持搜索、筛选）
  - `GET /api/assets/{record_id}` — 资产详情
  - 所有接口遵循 RLS：employee 仅见自己数据

#### P5-7: "流光"对话界面
- `/chat` 路由
- 类 ChatGPT 的对话界面：
  - 消息气泡（用户/助手）
  - 流式接收 SSE 输出，逐字渲染
  - 支持 Markdown 渲染
  - 对话历史本地维护，新建对话清空
- 引用来源展示：点击可跳转对应资产详情

#### P5-8: ETL 管理面板 (Admin)
- `/admin/etl` 路由（仅 admin 可见）
- 注册中心表展示
- 各表同步状态看板：最近同步时间、状态、记录数
- 手动触发同步按钮
- 同步日志展示

#### P5-9: 响应式与体验优化
- 加载状态（Skeleton / Spinner）
- 错误边界与 Toast 提示
- 空状态友好提示
- 移动端基础适配

### 验收标准
- [ ] 飞书 OAuth 登录流程完整可用
- [ ] 看板正确展示当前用户的资产统计数据
- [ ] 资产列表支持搜索、筛选、分页
- [ ] "流光"对话界面可正常流式对话，Markdown 渲染正确
- [ ] admin 用户可见 ETL 管理面板，可手动触发同步
- [ ] employee 用户看不到 admin 功能入口
- [ ] 页面加载有 loading 状态，API 异常有 Toast 提示

---

## P6 — 集成测试、部署与上线收尾

### 目标
完成端到端集成测试、Docker 容器化、部署配置与文档编写，确保系统可稳定交付。

### 任务清单

#### P6-1: 端到端集成测试
- 编写集成测试用例覆盖核心链路：
  - 飞书登录 → 获取 JWT → 访问受保护接口
  - ETL 抓取 → 清洗 → 入库 → 通过 API 查询
  - RAG 问答 → 权限隔离验证
- 使用 `pytest` + `httpx.AsyncClient` 进行 API 集成测试
- 使用测试数据库（独立 schema 或 Docker 临时容器）

#### P6-2: 数据权限隔离专项测试
- 创建两个测试用户 A (employee) 和 B (employee)
- 分别插入各自的数据资产
- 验证：
  - A 查不到 B 的资产
  - B 查不到 A 的资产
  - admin 可查到全部
  - RAG 问答中 A 的回答不包含 B 的数据

#### P6-3: Docker 容器化
- 编写 `backend/Dockerfile`：Python 多阶段构建
- 编写 `docker-compose.yml`：
  - `postgres` 服务（挂载数据卷，预装 pgvector 扩展）
  - `backend` 服务（依赖 postgres）
  - `frontend` 服务（Nginx 静态托管 + 反向代理）
- 编写 `.dockerignore`

#### P6-4: 数据库初始化脚本
- `scripts/init_db.sql`：
  - 创建数据库
  - 启用 pgvector 扩展
  - 创建初始 admin 用户（可选）
- Docker entrypoint 中自动执行

#### P6-5: 环境变量与密钥管理
- 整理生产环境 `.env` 配置清单
- 敏感信息（API Key 等）使用环境变量注入，不硬编码
- 编写 `.env.production.example`

#### P6-6: 日志与监控基础
- 配置 `logging` 统一日志格式（JSON 格式便于采集）
- ETL 任务日志记录到文件（按天轮转）
- 关键操作日志：登录、ETL 执行、RAG 查询

#### P6-7: API 文档完善
- 确认 FastAPI 自动生成的 Swagger UI (`/docs`) 信息完整
- 为所有接口补充 `summary`, `description`, `response_model`
- 添加请求/响应示例

#### P6-8: 项目文档
- 更新 `README.md`：项目介绍、架构图、本地开发指南、部署指南
- 编写 `CHANGELOG.md`（如需要）

### 验收标准
- [ ] 所有集成测试通过，核心链路无阻断
- [ ] 数据权限隔离专项测试全部通过，零越权
- [ ] `docker-compose up` 一键启动全部服务，首次启动自动完成数据库初始化
- [ ] 前端通过 Nginx 反向代理正常访问后端 API
- [ ] Swagger UI 文档完整，所有接口可在线测试
- [ ] 日志输出格式统一，ETL 日志可追溯
- [ ] `.env.production.example` 包含所有必要配置项

---

## 风险与注意事项

| 风险项 | 影响 | 应对策略 |
|--------|------|----------|
| 飞书 API 限流 | ETL 抓取失败 | 内置 QPS 控制 + 指数退避重试 |
| LLM API 不可用 | Schema 映射失败 | 缓存机制 + 映射失败告警 + 跳过继续 |
| Embedding 维度变更 | 向量索引失效 | 配置化 Embedding 维度，迁移脚本预留 |
| 飞书多维表格 Schema 频繁变更 | 映射缓存失效 | 基于 MD5 自动感知变更，触发重新映射 |
| 数据量增长导致向量检索变慢 | RAG 响应延迟 | IVFFlat 索引 + 定期 REINDEX + 未来可切换 HNSW |

---

## 开发顺序约定

1. 严格按 P0 → P1 → P2 → P3 → P4 → P5 → P6 顺序推进
2. 每个阶段完成后，对照验收标准逐项检查
3. 验收通过后方可进入下一阶段
4. 每个阶段的代码需包含对应的单元/集成测试
5. 遇到需要调整计划的情况，先讨论再修改
