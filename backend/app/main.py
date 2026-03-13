from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.assets import router as assets_router
from app.logging_config import setup_logging

setup_logging()
from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.communications import router as communications_router
from app.api.data_import import router as data_import_router
from app.api.departments import router as departments_router
from app.api.documents import router as documents_router
from app.api.etl import router as etl_router
from app.api.upload import router as upload_router
from app.api.users import router as users_router
from app.api.todos import router as todos_router
from app.api.reports import router as reports_router
from app.api.knowledge_graph import router as kg_router
from app.api.insights import router as insights_router
from app.api.profile import router as profile_router
from app.api.search import router as search_router
from app.api.structured_tables import router as structured_tables_router
from app.api.calendar import router as calendar_router
from app.api.conversations import router as conversations_router
from app.api.tags import router as tags_router
from app.api.settings import router as settings_router
from app.api.extraction_rules import router as extraction_rules_router
from app.api.cleaning_rules import router as cleaning_rules_router
from app.api.feishu_webhook import router as feishu_webhook_router
from app.database import async_session, engine
from app.worker.scheduler import init_scheduler, shutdown_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时: 验证数据库连接
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))
    # 清理上次异常退出残留的 running 状态
    async with async_session() as db:
        await db.execute(
            text(
                "UPDATE etl_sync_state SET last_sync_status = 'idle' "
                "WHERE last_sync_status = 'running'"
            )
        )
        await db.commit()
    # 启动定时任务调度器
    init_scheduler()
    yield
    # 关闭时: 停止调度器 & 释放连接池
    shutdown_scheduler()
    await engine.dispose()


app = FastAPI(
    title="流光智能数据资产平台",
    description="飞书企业级 ETL 与流光智能数据资产平台 API",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 注册路由 ──
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(etl_router)
app.include_router(chat_router)
app.include_router(assets_router)
app.include_router(documents_router)
app.include_router(communications_router)
app.include_router(upload_router)
app.include_router(data_import_router)
app.include_router(departments_router)
app.include_router(todos_router)
app.include_router(reports_router)
app.include_router(kg_router)
app.include_router(insights_router)
app.include_router(profile_router)
app.include_router(search_router)
app.include_router(structured_tables_router)
app.include_router(conversations_router)
app.include_router(calendar_router)
app.include_router(tags_router)
app.include_router(settings_router)
app.include_router(extraction_rules_router)
app.include_router(cleaning_rules_router)
app.include_router(feishu_webhook_router)


@app.get("/health", summary="健康检查")
async def health_check():
    """检查服务与数据库连通性。"""
    try:
        async with async_session() as session:
            result = await session.execute(text("SELECT 1"))
            result.scalar()
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return {"status": "error", "db": str(e)}
