# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

流光 (Liuguang) — Intelligent Data Asset Platform. An enterprise full-stack application that syncs data from Feishu (Lark) Bitable via an LLM-powered ETL pipeline into PostgreSQL with pgvector, then exposes a RAG-based Q&A assistant ("Flow Light"). Currently in early development (P0 skeleton complete, P1 auth in progress).

## Commands

```bash
# Start PostgreSQL (pgvector) via Docker
docker-compose up -d

# Install Python dependencies (from backend/)
cd backend && pip install -r requirements.txt

# Run database migrations
cd backend && alembic upgrade head

# Create a new migration after model changes
cd backend && alembic revision --autogenerate -m "description"

# Start dev server (from backend/)
cd backend && uvicorn app.main:app --reload

# Run tests
cd backend && pytest tests/

# Run a single test file
cd backend && pytest tests/test_something.py -v
```

## Architecture

### Layered Backend (backend/app/)

```
api/          → FastAPI route handlers (auth, assets, chat)
  deps.py     → Dependency injection: get_db session, get_current_user
models/       → SQLAlchemy 2.0 async ORM models (User, DataAsset, ETLSyncState, SchemaMappingCache)
schemas/      → Pydantic request/response models
services/     → Business logic layer
  feishu.py   → Feishu API client (OAuth, Bitable reads)
  llm.py      → LLM schema mapping & embedding generation
  rag.py      → Hybrid vector + keyword search, RRF fusion
  etl/        → ETL pipeline: extractor → transformer → loader
utils/        → JWT helpers, Feishu webhook alerts
worker/       → APScheduler background tasks (ETL cron jobs)
```

### Key Architectural Patterns

- **Async-first**: All DB access uses SQLAlchemy async + asyncpg. All external HTTP calls use httpx async.
- **Config via Pydantic Settings**: `app/config.py` loads from `.env` file. Use `settings.{field}` to access. Copy `.env.example` to `.env` for local dev.
- **Database**: PostgreSQL 16 with pgvector extension. Async engine in `app/database.py`. ORM base class is `Base` from `database.py`.
- **Row-Level Security**: Enforced at ORM query layer — always filter by `owner_id = current_user.feishu_open_id` for non-admin users.
- **ETL Pipeline**: Registry-driven incremental sync from Feishu Bitable. LLM maps source schemas to the `data_assets` table. Unmappable fields go to `asset_tags` JSONB. Schema mapping results are cached by MD5 hash in `schema_mapping_cache`.
- **RAG**: 1536-dim embeddings (DeepSeek/Qwen), cosine similarity + BM25 keyword search, Reciprocal Rank Fusion. Responses streamed via SSE.
- **Auth**: Feishu OAuth 2.0 SSO → JWT (HS256, 24h expiry). Three roles: employee, executive, admin.
- **LLM Integration**: Uses OpenAI-compatible SDK pointed at DeepSeek/Qwen endpoints. Three separate LLM configs: schema mapping, embedding, and agent chat.

### Database Tables

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `users` | Feishu SSO users with RBAC roles | `id` (serial) |
| `data_assets` | Core content store with vector embeddings | `feishu_record_id` (varchar) |
| `etl_sync_state` | Tracks per-source incremental sync progress | `id` (serial) |
| `schema_mapping_cache` | Caches LLM schema mapping results by MD5 | `id` (serial) |

### Development Phases (see Plan.md)

P0 Skeleton ✓ → P1 Auth (current) → P2 ETL Extract → P3 LLM Transform/Load → P4 RAG Agent → P5 Frontend → P6 Integration/Deploy
