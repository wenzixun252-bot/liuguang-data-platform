from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.etl import router as etl_router
from app.api.users import router as users_router
from app.database import async_session, engine
from app.worker.scheduler import init_scheduler, shutdown_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时: 验证数据库连接
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))
    # 启动定时任务调度器
    init_scheduler()
    yield
    # 关闭时: 停止调度器 & 释放连接池
    shutdown_scheduler()
    await engine.dispose()


app = FastAPI(
    title="流光智能数据资产平台",
    description="飞书企业级 ETL 与流光智能数据资产平台 API",
    version="0.1.0",
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
