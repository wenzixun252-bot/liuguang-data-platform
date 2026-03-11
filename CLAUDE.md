# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

流光 (Liuguang) — Intelligent Data Asset Platform. An enterprise full-stack application that syncs data from Feishu (Lark) Bitable via an LLM-powered ETL pipeline into PostgreSQL with pgvector, then exposes a RAG-based Q&A assistant ("Flow Light").

## Commands

```bash
# Start PostgreSQL (pgvector) via Docker
docker-compose up -d

# Full stack via Docker (postgres + backend + frontend/nginx)
docker-compose up -d --build

# Install Python dependencies (from backend/)
cd backend && pip install -r requirements.txt

# Run database migrations
cd backend && alembic upgrade head

# Create a new migration after model changes
cd backend && alembic revision --autogenerate -m "description"

# Start backend dev server
cd backend && uvicorn app.main:app --reload

# Start frontend dev server
cd frontend && npm run dev

# Run backend tests
cd backend && pytest tests/
cd backend && pytest tests/test_something.py -v

# Frontend lint
cd frontend && npm run lint

# Frontend build (includes tsc type-check)
cd frontend && npm run build
```

## Architecture

### Backend (backend/app/)

```
main.py       -> FastAPI app entry (23 routers, CORS, lifespan scheduler)
config.py     -> Pydantic Settings from .env (DB, Feishu, LLM, embedding configs)
database.py   -> AsyncEngine + AsyncSession (pool_size=10, max_overflow=20)
api/          -> FastAPI route handlers (23 routers + deps.py)
  deps.py     -> Dependency injection: get_db, get_current_user, get_visible_owner_ids, require_role
models/       -> SQLAlchemy 2.0 async ORM (21 model files)
schemas/      -> Pydantic request/response models
services/     -> Business logic (feishu.py, llm.py, rag.py, kg_builder.py, graph_rag.py, todo_extractor.py, kg_analyzer.py, leadership_analyzer.py, report_generator.py...)
  etl/        -> ETL pipeline: preprocessor -> extractor -> transformer -> enricher -> postprocessor -> loader (+ recording_matcher, hardcoded_comm)
utils/        -> JWT helpers, Feishu webhook alerts
worker/       -> APScheduler background tasks (ETL cron, default 30min)
```

### Frontend (frontend/src/)

```
pages/        -> Route-level page components (17 pages)
components/   -> Shared UI components (Layout, GlobalSearch, TagManager, ChatMessages...)
  insights/   -> Dashboard widget components (TrendWidget, KGMiniWidget, DataGraphWidget, AssetScoreWidget, OrgHealthWidget...)
  import/     -> Data import components (SmartDropZone, ExtractionRuleEditor, CleaningRuleEditor, DataRuleSection...)
lib/          -> API client (axios), auth helpers, feishu SDK
hooks/        -> Custom hooks (useAuth, useWidgetConfig, useColumnSettings, useTaskProgress)
```

### Key Architectural Patterns

- **Async-first**: All DB access uses SQLAlchemy async + asyncpg. All external HTTP calls use httpx async.
- **Config via Pydantic Settings**: `app/config.py` loads from `.env` file. Copy `.env.example` to `.env` for local dev.
- **Row-Level Security**: Every query filters by `get_visible_owner_ids()` which computes: own data + direct shares (UserVisibilityOverride) + department shares (UserDeptSharing). Admins see all.
- **Three Core Content Tables**: Document, Meeting, ChatMessage — each with 1024-dim vector embeddings (BAAI/bge-m3) for RAG.
- **Hybrid RAG**: Vector cosine similarity + BM25 keyword search + Reciprocal Rank Fusion. Permission-aware. Streams via SSE.
- **Knowledge Graph**: KGEntity + KGRelation extracted from content, used to enhance RAG context via graph_rag.py.
- **Tag System**: TagDefinition (project|priority|topic|custom) linked to content via ContentTag. ETL auto-tags via default_tag_ids.
- **Extraction/Cleaning Rules**: ExtractionRule and CleaningRule as persistent entities with dedicated API routers, configurable per ETL data source.
- **Auth**: Feishu OAuth 2.0 SSO -> JWT (HS256, 24h). Roles: employee, admin.

### Frontend Tech Stack

- **React 19** + TypeScript + Vite 7 + React Router 7 (nested routes with `<Outlet />`)
- **TanStack React Query** for server state (retry: 1, refetchOnWindowFocus: false)
- **Tailwind CSS 4** — utility-first styling, no component library
- **Axios** with JWT interceptor + 401 auto-redirect
- **Lucide React** icons, **Recharts** + **D3** for charts, **react-markdown** for content rendering
- **Framer Motion** for page transitions and animations
- **react-hot-toast** for notifications (top-right, 3s)

### Route Structure

| Path | Page | Description |
|------|------|-------------|
| `/login` | Login | Feishu OAuth callback |
| `/data-insights` | DataInsights | Dashboard with configurable widgets, stats cards, todos |
| `/data-import` | DataImport | File upload, ETL trigger, extraction/cleaning rules |
| `/documents` | Documents | Document list with search, tags, cloud sync |
| `/communications` | Communications | Meetings & chat messages (unified) |
| `/structured-tables` | StructuredTables | Structured table data view |
| `/chat` | Chat | AI assistant with tabs: chat, todos, graph, calendar |
| `/search` | SearchPage | Global cross-content search results |
| `/settings` | Settings | User preferences, ETL admin, permissions |
| `/reports` | Reports | Report list |
| `/reports/:id` | ReportDetail | Report viewer |
| `/todos` | Todos | Todo management |
| `/knowledge-graph` | KnowledgeGraph | Full KG visualization |
| `/leadership-insight` | LeadershipInsight | Leadership analytics |
| `/department-admin` | DepartmentAdmin | Department management |
| `/etl-admin` | ETLAdmin | ETL pipeline administration |
| `/calendar` | CalendarAssistant | Calendar assistant |

Legacy redirects: `/meetings`, `/messages` redirect to `/communications`.

### Key Environment Variables (.env)

Backend (`backend/.env`):
- `DATABASE_URL` — PostgreSQL async connection string (asyncpg)
- `FEISHU_APP_ID`, `FEISHU_APP_SECRET` — Feishu app credentials
- `JWT_SECRET_KEY` — HS256 signing key (24h expiry)
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` — OpenAI-compatible LLM for ETL/chat
- `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL` — Embedding model (default: BAAI/bge-m3, 1024-dim)
- `SUPER_ADMIN_OPEN_ID` — Immutable system admin Feishu open_id

Frontend (`frontend/.env`):
- `VITE_FEISHU_APP_ID`, `VITE_FEISHU_REDIRECT_URI` — Feishu OAuth for frontend

### Docker Deployment

Three-service stack in `docker-compose.yml`:
- **postgres** (pgvector/pgvector:pg16) — port 5432, database `liuguang`
- **backend** (FastAPI) — port 8000, runs `alembic upgrade head` then `uvicorn`
- **frontend** (Nginx) — port 80, serves React SPA with `/api` proxy to backend

Deployment script: `build-and-deploy.sh` for automated build and deploy.
45 Alembic migrations as of latest.

---

## Frontend Design Rules

Every frontend modification MUST follow these rules to ensure consistent UX and visual quality.

### Using Frontend Design Skill (IMPORTANT)

创建或修改前端页面、组件时，**务必使用 `frontend-design` skill** 以确保设计质量：

```
# 创建新页面或组件时，先调用此 skill
skill: "document-skills:frontend-design"
```

**触发场景：**
- 创建新的页面组件（如 Dashboard、Settings 页面）
- 设计复杂的 UI 交互（如拖拽看板、表单向导）
- 重构现有页面以提升视觉质量
- 构建可复用的 UI 组件库

**该 Skill 提供：**
- 生产级的前端代码生成（React + Tailwind）
- 响应式布局与无障碍访问最佳实践
- 与项目设计系统一致的样式规范

### Design System (DO NOT deviate)

- **Primary color**: Indigo-600 (`bg-indigo-600`, `text-indigo-700`, `ring-indigo-200`)
- **Brand gradient**: `from-indigo-500 to-purple-600` (logo, hero elements, stat cards)
- **Card style**: `bg-white rounded-xl shadow-sm border border-gray-200 p-5`
- **Button style**: `px-4 py-2 rounded-lg text-sm font-medium transition-colors` + color variant
- **Input style**: `bg-white border border-gray-200 rounded-lg text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200`
- **Status colors**: green/emerald = success, red = error/destructive, orange = warning/pending, blue = info/progress, purple = KG entities
- **Border radius**: `rounded-lg` (8px) for small elements, `rounded-xl` (12px) for cards, `rounded-2xl` (16px) for modals
- **Spacing**: Use Tailwind gap/padding utilities consistently (`gap-3/4/6`, `p-4/5/6`)

### Typography

- Headings: `font-semibold` with `text-xl` or `text-2xl`
- Labels & sub-headings: `font-medium` with `text-sm`
- Body text: normal weight, `text-sm` or `text-base`
- Muted text: `text-gray-500` or `text-gray-400`

### Responsive Layout

- Mobile-first: base classes for mobile, `lg:` for desktop
- Sidebar: fixed on desktop (`lg:static`), overlay on mobile
- Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` for card layouts

### UX Principles

1. **Every action needs feedback** — Use `react-hot-toast` for success/error notifications. Show loading states (spinner or skeleton) during async operations. Disable buttons while submitting.
2. **Progressive disclosure** — Show summary first, details on demand. Use collapsible sections and modals for complex content.
3. **Keyboard accessible** — Ctrl+K for global search. Escape to close modals. Tab navigation for forms.
4. **Consistent empty states** — When a list is empty, show a friendly message with an icon and a call-to-action button (e.g., "No documents yet. Click to sync from Feishu").

### Animation & Transitions

- Use `transition-colors` on hover states (buttons, links, nav items)
- Use `transition-all duration-200` for expand/collapse
- Lazy load heavy components with `React.lazy()` + `Suspense` (e.g., KnowledgeGraph, CalendarAssistant)
- Avoid gratuitous animation — motion should serve navigation clarity, not decoration

---

## Data Interconnection Design (CRITICAL)

The platform's core value is connecting data across content types. Every page and component must reinforce cross-data navigation.

### Navigation Patterns

**1. Clickable entity references everywhere:**
- Person names -> `/chat?tab=graph&entity=person:{name}` (KG person profile)
- Project names -> `/chat?tab=graph&entity=project:{name}` (KG project view)
- Document titles -> `/documents?highlight={id}` (scroll to & highlight)
- Meeting titles -> `/meetings?highlight={id}`
- Tags -> `/search?tag_ids={id}` (filter by tag across all content)

**2. URL-based state for deep linking:**
- Tab selection: `?tab=overview`, `?tab=todos`, `?tab=graph`
- Item highlighting: `?highlight={id}` to auto-scroll and highlight a specific row
- Search context: `?q={keyword}&content_types={type}&tag_ids={ids}`
- Entity focus: `?entity={type}:{name}` for knowledge graph navigation

**3. Global Search (Ctrl+K) as hub:**
- Searches across: documents, meetings, messages, structured tables, KG entities
- Each result links to its source page with `?highlight={id}`
- Results grouped by content type with clear type badges

**4. Cross-reference patterns in components:**
- Chat AI responses include source citations `[title]:[id]` — these MUST be clickable links to the source content page
- Knowledge graph nodes are clickable — navigate to filtered search or detail view
- Dashboard widgets link to their data source pages
- Tag chips are always clickable — navigate to `/search?tag_ids={id}`
- Meeting participants link to person profiles in KG
- Document authors link to person profiles in KG

### When Adding New Features

- If a new entity or content type is introduced, it MUST be:
  1. Searchable via GlobalSearch
  2. Taggable via the tag system (ContentTag)
  3. Linkable from KG entities (ContentEntityLink)
  4. Deep-linkable via URL params (`?highlight={id}`)
- If a new page is added, it MUST:
  1. Be registered in App.tsx routes
  2. Be added to Layout.tsx navigation (with appropriate icon from Lucide)
  3. Support `?highlight={id}` param for cross-page navigation
  4. Include breadcrumb or back-navigation context

### API Communication

- Base URL: `/api` (proxied to `http://127.0.0.1:8000` in Vite dev)
- Auth: Axios interceptor auto-adds `Authorization: Bearer {token}`
- Arrays in params: serialized as `tag_ids=1&tag_ids=2` (FastAPI compatible)
- 401 response: auto-clears auth + redirects to `/login`
- Streaming: SSE for chat responses, insights generation, calendar briefing

### Backend Data Flow (for context)

```
Feishu Sources -> ETL Pipeline -> Document/Meeting/ChatMessage (with embeddings)
                                       |
                              Tag System (ContentTag)
                                       |
                              KG Builder (KGEntity + KGRelation)
                                       |
                              RAG Hybrid Search (vector + BM25 + RRF)
                                       |
                              AI Chat (SSE streaming with source citations)
```

All content tables share a common pattern: `owner_id` for RLS, `content_vector` for RAG, linkable via `ContentTag` and `ContentEntityLink`.
