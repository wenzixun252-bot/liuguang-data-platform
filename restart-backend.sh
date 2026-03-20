#!/bin/bash
# Liuguang - Restart Backend

echo "============================================"
echo "  Liuguang - Restart Backend"
echo "============================================"
echo

export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1

echo "[1/3] Checking Docker Desktop ..."
if ! docker info > /dev/null 2>&1; then
    echo
    echo "[ERROR] Docker Desktop is not running!"
    echo "Please start Docker Desktop first."
    echo
    exit 1
fi
echo "      Docker Desktop is ready."
echo

echo "[2/3] Rebuilding and restarting backend ..."
echo
if ! docker compose up -d --build backend; then
    echo
    echo "[ERROR] Restart failed! Check the error above."
    echo
    exit 1
fi
echo

echo "[3/3] Waiting for backend to be ready ..."
count=0
max_count=30
while [ $count -lt $max_count ]; do
    if curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:8000/health 2>/dev/null | grep -q "200"; then
        echo "      Backend is ready!"
        break
    fi
    count=$((count + 1))
    sleep 2
done

if [ $count -ge $max_count ]; then
    echo
    echo "[WARN] Timeout after 60s. Backend may not be fully started."
fi

echo
echo "============================================"
echo "  Backend restarted successfully!"
echo
echo "  Backend: http://localhost:8000"
echo "  API Doc: http://localhost:8000/docs"
echo "============================================"
echo
