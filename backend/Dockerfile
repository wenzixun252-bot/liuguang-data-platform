# ── Stage 1: Build ──
FROM python:3.12-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: Runtime ──
FROM python:3.12-slim

WORKDIR /app

# 安装 PostgreSQL 客户端库（asyncpg 运行时需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

COPY alembic/ alembic/
COPY alembic.ini .
COPY app/ app/

# 创建上传和日志目录并设置非 root 用户
RUN useradd -m appuser && mkdir -p /app/uploads /app/logs && chown -R appuser:appuser /app/uploads /app/logs
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
