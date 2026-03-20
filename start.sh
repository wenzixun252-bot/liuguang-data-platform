#!/bin/bash
# 流光数据平台 - 启动

echo "============================================"
echo "   流光 (Liuguang) 智能数据资产平台"
echo "============================================"
echo

# 绕过代理访问 localhost
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1

# 1. 检查 Docker Desktop 是否运行
echo "[1/3] 检查 Docker Desktop ..."
if ! docker info > /dev/null 2>&1; then
    echo
    echo "[错误] Docker Desktop 未运行！"
    echo "请先启动 Docker Desktop，然后重新运行此脚本。"
    echo
    exit 1
fi
echo "      Docker Desktop 已就绪。"

# 2. 加载前端飞书配置（供 docker compose 构建参数使用）
if [ -f "frontend/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "frontend/.env"
    set +a
fi

# 3. 启动所有容器
echo
echo "[2/3] 启动容器 (docker compose up --build -d) ..."
echo "      首次构建可能需要几分钟，请耐心等待..."
echo
if ! docker compose up --build -d; then
    echo
    echo "[错误] Docker Compose 启动失败！请检查上方错误信息。"
    echo
    exit 1
fi

# 4. 等待后端就绪
echo
echo "[3/3] 等待后端服务就绪 ..."
count=0
max_count=40
while [ $count -lt $max_count ]; do
    if curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:8000/health 2>/dev/null | grep -q "200"; then
        echo "      后端已就绪！"
        break
    fi
    count=$((count + 1))
    sleep 3
done

if [ $count -ge $max_count ]; then
    echo
    echo "[警告] 等待超时，后端可能尚未完全启动。"
    echo "      你可以稍后手动访问 http://localhost"
fi

echo
echo "============================================"
echo "  平台已启动！正在打开浏览器..."
echo
echo "  前端:    http://localhost"
echo "  后端:    http://localhost:8000"
echo "  API文档: http://localhost:8000/docs"
echo "============================================"
echo

open "http://localhost"
