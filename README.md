# 流光智能数据资产平台

飞书企业级 ETL 与智能问答平台 — 从飞书多维表格自动同步数据，LLM 驱动 Schema 映射，向量化存储后提供权限感知的 RAG 智能问答。

## 架构概览

```
┌─────────────┐     ┌──────────────────────────────────────────────────┐
│   Frontend   │────▶│                   Backend (FastAPI)               │
│  React+Vite  │     │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  Tailwind    │     │  │ Auth API │  │ Asset API│  │  Chat API    │  │
│              │     │  │(飞书SSO) │  │ (RLS)    │  │ (SSE 流式)   │  │
└─────────────┘     │  └──────────┘  └──────────┘  └──────────────┘  │
                    │  ┌──────────────────────────────────────────┐   │
                    │  │        ETL Pipeline (APScheduler)         │   │
                    │  │  Extract → LLM Transform → Embed → Load  │   │
                    │  └──────────────────────────────────────────┘   │
                    │  ┌──────────────────────────────────────────┐   │
                    │  │         RAG Engine (Hybrid Search)        │   │
                    │  │     Vector (pgvector) + BM25 + RRF        │   │
                    │  └──────────────────────────────────────────┘   │
                    └──────────────────────┬───────────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────────┐
                    │           PostgreSQL 16 + pgvector                │
                    │  users │ data_assets │ etl_sync_state │ cache    │
                    └─────────────────────────────────────────────────┘
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19, TypeScript, Vite, Tailwind CSS, Recharts |
| 后端 | FastAPI, SQLAlchemy 2.0 (async), Pydantic v2 |
| 数据库 | PostgreSQL 16 + pgvector |
| LLM | OpenAI 兼容 SDK (DeepSeek / Qwen) |
| 认证 | 飞书 OAuth 2.0 SSO → JWT (HS256) |
| 调度 | APScheduler (AsyncIOScheduler) |
| 部署 | Docker Compose (postgres + backend + frontend/Nginx) |

## 快速开始

### 1. 克隆并配置环境变量

```bash
git clone <repo-url>
cd liuguang-data-platform

# 复制环境变量模板
cp backend/.env.example backend/.env
# 编辑 .env 填入飞书 App ID/Secret、LLM API Key 等
```

### 2. Docker 一键启动

```bash
docker-compose up -d
```

首次启动会自动完成：
- PostgreSQL 初始化 + pgvector 扩展
- Alembic 数据库迁移
- 后端服务启动 (端口 8000)
- 前端 Nginx 启动 (端口 80)

访问 `http://localhost` 打开前端，`http://localhost:8000/docs` 查看 API 文档。

### 3. 本地开发 (无 Docker)

```bash
# 启动 PostgreSQL (需预装 pgvector 扩展)
docker-compose up -d postgres

# 后端
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload

# 前端
cd frontend
npm install
npm run dev
```

## 项目结构

```
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── config.py            # Pydantic Settings 配置
│   │   ├── database.py          # 异步 SQLAlchemy 引擎
│   │   ├── logging_config.py    # JSON 日志 + ETL 按天轮转
│   │   ├── api/                 # 路由层 (auth, users, assets, etl, chat)
│   │   ├── models/              # ORM 模型 (User, DataAsset, ETLSyncState)
│   │   ├── schemas/             # Pydantic 请求/响应模型
│   │   ├── services/            # 业务逻辑 (feishu, llm, rag, etl/)
│   │   ├── worker/              # APScheduler 定时任务
│   │   └── utils/               # JWT, 飞书 Webhook
│   ├── tests/                   # 101 个单元测试 + 集成测试
│   ├── alembic/                 # 数据库迁移
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/               # Login, Dashboard, Assets, Chat, ETLAdmin
│   │   ├── components/          # Layout, ProtectedRoute
│   │   ├── hooks/               # useAuth
│   │   └── lib/                 # api (axios), auth, feishu
│   ├── nginx.conf               # Nginx 反代 + SPA 回退
│   └── Dockerfile
├── scripts/init_db.sql          # 数据库初始化 (pgvector 扩展)
├── docker-compose.yml           # 一键部署
└── Plan.md                      # 开发计划 (P0-P6)
```

## 核心功能

### 飞书 SSO 认证
- 飞书 OAuth 2.0 免登 → JWT 令牌
- 三级 RBAC: employee / executive / admin
- 行级安全 (RLS): employee 仅可见自己的数据

### ETL 数据同步
- 从飞书多维表格增量抽取数据
- LLM 自动映射源表 Schema 到标准结构 (带 MD5 缓存)
- 未映射字段自动归入 `asset_tags` JSONB
- 1536 维向量 Embedding + Upsert 入库
- APScheduler 每 30 分钟自动同步，支持手动触发
- 异常告警推送到飞书群

### "流光"智能问答
- 混合检索: 向量相似度 + BM25 全文检索
- Reciprocal Rank Fusion (RRF) 排序融合
- SSE 流式输出 + Markdown 渲染
- 对话历史上下文 (最近 10 轮)
- 权限隔离: 回答仅基于用户可见数据

### 数据看板
- 资产统计 (总量、类型分布饼图、30天趋势折线图)
- 资产列表 (搜索、筛选、分页、详情面板)
- ETL 管理 (同步状态、注册中心、手动触发)

## API 接口

| 接口 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/api/auth/feishu/callback` | POST | 公开 | 飞书 OAuth 回调 |
| `/api/users/me` | GET | 登录 | 当前用户信息 |
| `/api/users` | GET | admin | 用户列表 |
| `/api/users/{id}/role` | PATCH | admin | 修改用户角色 |
| `/api/assets/stats` | GET | 登录 | 资产统计 |
| `/api/assets/list` | GET | 登录 | 资产列表 (分页) |
| `/api/assets/{id}` | GET | 登录 | 资产详情 |
| `/api/chat/ask` | POST | 登录 | 非流式问答 |
| `/api/chat/stream` | POST | 登录 | 流式问答 (SSE) |
| `/api/etl/status` | GET | admin | 同步状态 |
| `/api/etl/trigger` | POST | admin | 手动触发同步 |
| `/api/etl/registry` | GET | admin | 注册中心 |
| `/health` | GET | 公开 | 健康检查 |

## 测试

```bash
cd backend
pytest tests/ -v
```

101 个测试覆盖:
- JWT 认证与 RBAC 权限控制
- 飞书 OAuth 回调流程
- ETL 全链路 (Extract → Transform → Load)
- RAG 混合检索与 RRF 融合
- Chat 流式/非流式端点
- 数据权限隔离 (零越权)
- 资产管理接口

## 开发阶段

- [x] P0 — 工程骨架与数据库底座
- [x] P1 — 飞书 SSO 鉴权与 RBAC 权限
- [x] P2 — ETL 数据抓取与增量同步
- [x] P3 — LLM 动态清洗与资产入库
- [x] P4 — "流光"智能助手 RAG 问答
- [x] P5 — 前端数据看板与交互界面
- [x] P6 — 集成测试、部署与上线收尾
