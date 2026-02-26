from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.database import async_session, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时: 验证数据库连接
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))
    yield
    # 关闭时: 释放连接池
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
