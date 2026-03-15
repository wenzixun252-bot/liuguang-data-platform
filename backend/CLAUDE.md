# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is the **backend** subdirectory of 流光数据中台 (Liuguang Data Platform). See the root `../CLAUDE.md` for full-stack context, frontend design rules, and data interconnection patterns.

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run dev server (auto-reload)
uvicorn app.main:app --reload

# Run all tests (SQLite in-memory, no PostgreSQL needed)
pytest tests/

# Run a single test file / single test function
pytest tests/test_auth.py -v
pytest tests/test_auth.py::test_feishu_callback_success -v

# Database migrations
alembic upgrade head
alembic revision --autogenerate -m "description"

# API docs (after starting server)
# http://localhost:8000/docs
```

## Architecture

### Request Flow

```
HTTP Request
  -> main.py (FastAPI app, CORS, lifespan)
  -> api/{resource}.py (router, validation, deps injection)
  -> api/deps.py (get_db, get_current_user, get_visible_owner_ids, require_role)
  -> services/{module}.py (business logic, external API calls)
  -> models/{model}.py (SQLAlchemy 2.0 async ORM)
  -> schemas/{schema}.py (Pydantic request/response models)
```

### Key Files

- `app/config.py` — Singleton `settings` object (Pydantic Settings from `.env`). All config access via `from app.config import settings`.
- `app/database.py` — `engine`, `async_session`, `Base` (DeclarativeBase). Pool: 10 connections, max overflow 20.
- `app/api/deps.py` — Core dependency injection. Every data query MUST use `get_visible_owner_ids()` for RLS filtering.
- `app/main.py` — 26 routers registered. Lifespan resets stuck ETL states and starts APScheduler.

### Dependency Injection Pattern

Every authenticated endpoint follows this pattern:
```python
@router.get("/list")
async def list_items(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    visible_ids = await get_visible_owner_ids(current_user, db, request)
    # visible_ids is None for admin in admin-mode (X-Admin-Mode: true header)
    # visible_ids is list[str] for employees / admin in personal mode
    stmt = select(Model)
    if visible_ids is not None:
        stmt = stmt.where(Model.owner_id.in_(visible_ids))
```

Admin-mode toggle: admin users send `X-Admin-Mode: true` header to see all data.

### ETL Pipeline (services/etl/)

Sequential 6-step pipeline, each step is a separate module:
1. **preprocessor.py** — Rule-based text cleaning (HTML strip, normalize whitespace/names/timestamps). No LLM.
2. **extractor.py** — Reads enabled data sources from DB (`ETLDataSource`), pulls incremental data from Feishu Bitable.
3. **transformer.py** — LLM-powered schema mapping + extraction rules. Produces `TransformResult` with `TransformedDocument` / `TransformedCommunication`.
4. **enricher.py** — Adds metadata enrichment (sentiment, categories, keywords via LLM).
5. **postprocessor.py** — Final content cleanup and validation after LLM processing.
6. **loader.py** — Generates embeddings (1024-dim, BAAI/bge-m3), upserts into Document/Communication/StructuredTable, triggers KG builder.

Additional ETL modules:
- `recording_matcher.py` — Matches meeting recordings to communications.
- `hardcoded_comm.py` — Handles special-case communication imports.

### Background Tasks (worker/)

- `scheduler.py` — APScheduler (AsyncIOScheduler). Calendar reminders run every 2 hours. ETL sync triggered on user login via `trigger_login_sync()`.
- `tasks.py` — Job functions: `etl_sync_job`, `cloud_folder_sync_job`, `todo_extract_job`, `todo_sync_status_job`, `structured_table_sync_job`, `calendar_reminder_job`.

### Models Convention

All models inherit `app.database.Base`. Key patterns:
- Content tables (`Document`, `Communication`, `StructuredTable`) share: `owner_id` (feishu_open_id for RLS), `content_vector` (pgvector 1024-dim), `content_hash` (MD5 dedup).
- Use `Mapped[type]` with `mapped_column()` (SQLAlchemy 2.0 style). No `relationship()` — joins are explicit in queries.
- PostgreSQL-specific: `JSONB` for flexible fields, `Vector(1024)` for embeddings, `CheckConstraint` for enum-like columns, GIN indexes for JSONB.
- `feishu_record_id` + `owner_id` unique constraint for Feishu-sourced upserts.

### Testing

- Tests use **SQLite in-memory** (`aiosqlite`) via `conftest.py`. Only `User` and `ETLSyncState` tables are created — models using pgvector/JSONB are skipped.
- `pytest.ini`: `asyncio_mode = auto` — no need for `@pytest.mark.asyncio` decorator.
- Key fixtures in `conftest.py`:
  - `db_session` — async SQLAlchemy session
  - `client` — unauthenticated httpx AsyncClient (ASGI transport)
  - `authed_client` — authenticated as `test_user` (employee role)
  - `admin_client` — authenticated as `admin_user` (admin role)
- Auth is overridden via `app.dependency_overrides[get_current_user]`, not via real JWT tokens.

### External Service Clients

All use **httpx async**. Key services:
- `services/feishu.py` — Feishu/Lark API client (Bitable CRUD, OAuth, cloud docs, meetings, chats). Uses both tenant_access_token and user_access_token.
- `services/llm.py` — OpenAI-compatible LLM calls (schema mapping, extraction, chat). Uses `openai` SDK with custom base_url.
- `services/rag.py` — Hybrid RAG: pgvector cosine similarity + BM25 keyword search + Reciprocal Rank Fusion. Permission-aware.
- `services/kg_builder.py` — Extracts KGEntity + KGRelation from content text via LLM.
- `services/graph_rag.py` — Enhances RAG context with knowledge graph traversal.

### Logging

JSON structured logging (`app/logging_config.py`). ETL logs written to `logs/etl.log` with daily rotation (30-day retention). Third-party libraries (httpx, sqlalchemy, apscheduler) suppressed to WARNING.

### Auth Flow

1. Frontend redirects to Feishu OAuth → user authorizes → callback with `code`
2. `api/auth.py` exchanges code for user_access_token + user info via Feishu API
3. Creates/updates User in DB (stores feishu tokens for later API calls)
4. Issues JWT (HS256, 24h expiry) with `sub=feishu_open_id` and `role`
5. Subsequent requests: `Authorization: Bearer {jwt}` → `get_current_user` dependency decodes and returns User ORM object
6. Super admin (`SUPER_ADMIN_OPEN_ID` in config) cannot be demoted via API
