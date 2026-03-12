#!/bin/bash
# ============================================================
# 流光数据平台 — Git Pull 远程部署脚本
# 在本地机器运行，SSH 到服务器执行 git pull + docker compose 重建
#
# 前提：服务器已完成首次初始化（见下方说明）
#
# 用法:
#   bash build-and-deploy.sh              # 拉取代码，重建前端+后端
#   bash build-and-deploy.sh backend      # 只重建后端（快速）
#   bash build-and-deploy.sh frontend     # 只重建前端
#
# 首次在服务器上初始化：
#   1. ssh root@服务器IP
#   2. cd /opt && git clone https://github.com/wenzixun252-bot/liuguang-data-platform.git
#   3. cd liuguang-data-platform && bash deploy.sh   (安装 Docker、配置 .env)
# ============================================================

set -e

# ── 配置区（按需修改） ─────────────────────────────
SERVER_IP="47.109.47.93"
SERVER_USER="root"
SERVER_PATH="/opt/liuguang-data-platform"
GIT_BRANCH="main"
# ──────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── 解析参数 ──
MODE="${1:-all}"

case "$MODE" in
  backend|b)  SERVICES="backend";          MODE_LABEL="仅后端" ;;
  frontend|f) SERVICES="frontend";         MODE_LABEL="仅前端" ;;
  all|"")     SERVICES="backend frontend"; MODE_LABEL="前端+后端" ;;
  *)
    echo -e "${RED}未知参数: $MODE${NC}"
    echo "用法: bash build-and-deploy.sh [all|backend|frontend]"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}===== 流光数据平台 · Git Pull 部署 (${MODE_LABEL}) =====${NC}"
echo ""

# ── 第 0 步：确保本地代码已推送 ──
echo -e "${YELLOW}[0] 检查本地代码是否已推送到远程...${NC}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOCAL_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
REMOTE_HEAD=$(git rev-parse origin/${GIT_BRANCH} 2>/dev/null || echo "unknown")

if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo -e "${YELLOW}  本地有未推送的提交！${NC}"
  echo -e "${YELLOW}  本地: ${LOCAL_HEAD:0:8}  远程: ${REMOTE_HEAD:0:8}${NC}"
  read -p "  是否先推送到远程? (y/n): " PUSH_FIRST
  if [ "$PUSH_FIRST" = "y" ] || [ "$PUSH_FIRST" = "Y" ]; then
    git push origin ${GIT_BRANCH}
    echo -e "${GREEN}  推送完成${NC}"
  else
    echo -e "${RED}  取消部署。请先 git push 再重新运行。${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}  本地和远程一致 (${LOCAL_HEAD:0:8})${NC}"
fi

# ── SSH 复用：只输一次密码 ──
SSH_SOCK="/tmp/ssh-deploy-$$"
echo ""
echo -e "${YELLOW}  建立 SSH 连接...${NC}"
ssh -M -f -N -o ControlPath="$SSH_SOCK" -o ControlPersist=300 "${SERVER_USER}@${SERVER_IP}" 2>/dev/null || true
SSH_CMD="ssh -o ControlPath=$SSH_SOCK"

cleanup() {
  ssh -o ControlPath="$SSH_SOCK" -O exit "${SERVER_USER}@${SERVER_IP}" 2>/dev/null || true
}
trap cleanup EXIT

# ── 第 1 步：拉取代码 ──
echo ""
echo -e "${GREEN}[1/3] 服务器拉取最新代码...${NC}"
$SSH_CMD "${SERVER_USER}@${SERVER_IP}" bash -s <<REMOTE_PULL
  set -e
  cd ${SERVER_PATH}
  echo "  当前分支: \$(git branch --show-current)"
  echo "  git pull origin ${GIT_BRANCH}..."
  git pull origin ${GIT_BRANCH}
  echo "  当前版本: \$(git log --oneline -1)"
REMOTE_PULL
echo -e "${GREEN}  OK${NC}"

# ── 第 2 步：构建并重启 ──
echo ""
echo -e "${GREEN}[2/3] 构建并重启服务 (${MODE_LABEL})...${NC}"
$SSH_CMD "${SERVER_USER}@${SERVER_IP}" bash -s <<REMOTE_BUILD
  set -e
  cd ${SERVER_PATH}

  echo "  docker compose build ${SERVICES}..."
  docker compose build ${SERVICES}

  echo "  重启服务（保留数据库）..."
  docker compose up -d --no-deps ${SERVICES}

  echo "  等待启动..."
  sleep 5
  docker compose ps
REMOTE_BUILD
echo -e "${GREEN}  OK${NC}"

# ── 第 3 步：清理 ──
echo ""
echo -e "${GREEN}[3/3] 清理旧镜像...${NC}"
$SSH_CMD "${SERVER_USER}@${SERVER_IP}" bash -s <<REMOTE_CLEAN
  docker image prune -f 2>/dev/null || true
REMOTE_CLEAN
echo -e "${GREEN}  OK${NC}"

echo ""
echo -e "${GREEN}===== 部署完成! (${MODE_LABEL}) =====${NC}"
echo "  访问: http://${SERVER_IP}"
echo ""
