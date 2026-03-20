#!/bin/bash
# 流光数据平台 - 重启后端并启动

echo "============================================"
echo "  流光 (Liuguang) - 重启后端并启动"
echo "============================================"
echo

# 绕过代理访问 localhost
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1

# 1. 检查 Docker Desktop
echo "[1/3] 检查 Docker Desktop ..."
if ! docker info > /dev/null 2>&1; then
    echo
    echo "[错误] Docker Desktop 未运行！"
    echo "请先启动 Docker Desktop，然后重新运行此脚本。"
    echo
    exit 1
fi
echo "      Docker Desktop 已就绪。"
echo

# 2. 重建并重启后端
echo "[2/3] 重建并重启后端 (docker compose up -d --build backend) ..."
echo
if ! docker compose up -d --build backend; then
    echo
    echo "[错误] 后端重启失败！请检查上方错误信息。"
    echo
    exit 1
fi
echo

# 3. 等待后端就绪
echo "[3/3] 等待后端服务就绪 ..."
count=0
max_count=30
while [ $count -lt $max_count ]; do
    if curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:8000/health 2>/dev/null | grep -q "200"; then
        echo "      后端已就绪！"
        break
    fi
    count=$((count + 1))
    sleep 2
done

if [ $count -ge $max_count ]; then
    echo
    echo "[警告] 等待超时(60s)，后端可能尚未完全启动"
    echo "      你可以稍后手动访问 http://localhost"
fi

echo
echo "============================================"
echo "  后端重启完成！正在打开浏览器..."
echo
echo "  前端:    http://localhost"
echo "  后端:    http://localhost:8000"
echo "  API文档: http://localhost:8000/docs"
echo "============================================"
echo

open "http://localhost"
