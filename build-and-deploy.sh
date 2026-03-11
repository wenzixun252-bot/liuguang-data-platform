#!/bin/bash
# ============================================================
# 流光数据平台 — 本地构建 & 远程部署脚本
# 在本地机器（有 Docker + VPN）运行
# 自动构建镜像 → 打包 → SCP 上传 → 服务器加载并重启
# ============================================================

set -e

# ── 配置区（按需修改） ─────────────────────────────
SERVER_IP="47.109.47.93"
SERVER_USER="root"
SERVER_PATH="/opt/liuguang-data-platform"
VITE_FEISHU_APP_ID="cli_a92bd828cbba1cb3"
VITE_FEISHU_REDIRECT_URI="http://${SERVER_IP}/login"
IMAGE_TAR="app-images.tar"
# ──────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${GREEN}===== 流光数据平台 · 本地构建 & 部署 =====${NC}"
echo ""

# ── 1. 构建后端镜像 ──
echo -e "${GREEN}[1/5] 构建后端镜像...${NC}"
docker build -t liuguang-data-platform-backend ./backend
echo -e "${GREEN}  ✓ 后端镜像构建完成${NC}"

# ── 2. 构建前端镜像 ──
echo ""
echo -e "${GREEN}[2/5] 构建前端镜像...${NC}"
docker build \
  --build-arg VITE_FEISHU_APP_ID="$VITE_FEISHU_APP_ID" \
  --build-arg VITE_FEISHU_REDIRECT_URI="$VITE_FEISHU_REDIRECT_URI" \
  -t liuguang-data-platform-frontend ./frontend
echo -e "${GREEN}  ✓ 前端镜像构建完成${NC}"

# ── 3. 打包镜像 ──
echo ""
echo -e "${GREEN}[3/5] 打包镜像为 ${IMAGE_TAR}...${NC}"
docker save \
  liuguang-data-platform-backend \
  liuguang-data-platform-frontend \
  -o "$IMAGE_TAR"
TAR_SIZE=$(du -h "$IMAGE_TAR" | cut -f1)
echo -e "${GREEN}  ✓ 打包完成，大小: ${TAR_SIZE}${NC}"

# ── 4. 上传到服务器 ──
echo ""
echo -e "${GREEN}[4/5] SCP 上传到服务器 ${SERVER_IP}...${NC}"
echo -e "${YELLOW}  (需要输入服务器密码)${NC}"
scp "$IMAGE_TAR" "${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/"
echo -e "${GREEN}  ✓ 上传完成${NC}"

# ── 5. 服务器端：加载镜像 + 重启服务 ──
echo ""
echo -e "${GREEN}[5/5] 在服务器上加载镜像并重启...${NC}"
echo -e "${YELLOW}  (需要输入服务器密码)${NC}"
ssh "${SERVER_USER}@${SERVER_IP}" bash -s <<REMOTE_EOF
  set -e
  cd ${SERVER_PATH}

  echo ">> 加载 Docker 镜像..."
  docker load -i ${IMAGE_TAR}

  echo ">> 重启服务 (保留数据库)..."
  docker compose up -d --no-build

  echo ">> 等待启动..."
  sleep 5
  docker compose ps

  echo ">> 清理镜像包..."
  rm -f ${IMAGE_TAR}
REMOTE_EOF

# ── 清理本地镜像包 ──
rm -f "$IMAGE_TAR"

echo ""
echo -e "${GREEN}===== 部署完成! =====${NC}"
echo "  访问: http://${SERVER_IP}"
echo ""
