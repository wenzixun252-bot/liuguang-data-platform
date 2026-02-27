"""测试公共 Fixtures。"""

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.deps import get_current_user, get_db
from app.database import Base
from app.main import app
from app.models.asset import ETLSyncState
from app.models.user import User

# SQLite 兼容的表 (不含 pgvector/JSONB 依赖)
_SQLITE_TABLES = [User.__table__, ETLSyncState.__table__]

# 使用 SQLite 内存数据库做测试 (无需 PostgreSQL)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine_test = create_async_engine(TEST_DATABASE_URL, echo=False)
async_session_test = async_sessionmaker(
    engine_test, class_=AsyncSession, expire_on_commit=False
)


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    """每个测试前重建 SQLite 兼容的表（跳过 pgvector/JSONB 依赖的表）。"""
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=_SQLITE_TABLES)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=_SQLITE_TABLES)


async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_test() as session:
        yield session


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """提供一个测试用的数据库 Session。"""
    async with async_session_test() as session:
        yield session


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """创建一个测试用户 (employee)。"""
    user = User(
        feishu_open_id="test_open_id_001",
        feishu_union_id="test_union_id_001",
        name="测试用户",
        avatar_url="https://example.com/avatar.png",
        email="test@example.com",
        role="employee",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession) -> User:
    """创建一个管理员用户。"""
    user = User(
        feishu_open_id="admin_open_id_001",
        feishu_union_id="admin_union_id_001",
        name="管理员",
        email="admin@example.com",
        role="admin",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """提供一个覆盖了 DB 依赖的测试客户端。"""
    app.dependency_overrides[get_db] = _override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def authed_client(test_user: User) -> AsyncGenerator[AsyncClient, None]:
    """提供一个以 test_user 身份登录的客户端。"""

    async def _override_current_user():
        return test_user

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_current_user
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def admin_client(admin_user: User) -> AsyncGenerator[AsyncClient, None]:
    """提供一个以 admin_user 身份登录的客户端。"""

    async def _override_current_user():
        return admin_user

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_current_user
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c
    app.dependency_overrides.clear()
