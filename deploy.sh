#!/bin/bash
# =============================================
# 流光智能数据资产平台 - 一键部署脚本
# 适用于全新 Ubuntu 22.04 LTS 服务器
# =============================================

set -e

echo "======================================"
echo "  流光数据平台 - 一键部署"
echo "======================================"
echo ""

# ---- 颜色定义 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ---- 检查是否以 root 运行 ----
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 root 用户运行此脚本: sudo bash deploy.sh${NC}"
  exit 1
fi

# ---- 步骤 1: 安装 Docker ----
echo -e "${GREEN}[1/6] 检查 Docker 安装...${NC}"
if ! command -v docker &> /dev/null; then
  echo "正在安装 Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  echo -e "${GREEN}Docker 安装完成!${NC}"
else
  echo "Docker 已安装，跳过"
fi

# ---- 配置 Docker 镜像加速 (国内加速) ----
echo -e "${GREEN}[2/6] 配置 Docker 镜像加速...${NC}"
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'DAEMON_EOF'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
DAEMON_EOF
  systemctl daemon-reload
  systemctl restart docker
  echo "镜像加速配置完成"
else
  echo "Docker daemon.json 已存在，跳过"
fi

# ---- 步骤 3: 检查项目目录 ----
echo -e "${GREEN}[3/6] 检查项目文件...${NC}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "docker-compose.yml" ]; then
  echo -e "${RED}错误: 未找到 docker-compose.yml，请确保在项目根目录下运行此脚本${NC}"
  exit 1
fi
echo "项目目录: $SCRIPT_DIR"

# ---- 步骤 4: 检查配置文件 ----
echo -e "${GREEN}[4/6] 检查配置文件...${NC}"

# 检查后端 .env
if [ ! -f "backend/.env" ]; then
  if [ -f "backend/.env.example" ]; then
    cp backend/.env.example backend/.env
    echo -e "${YELLOW}已从 .env.example 创建 backend/.env"
    echo -e "请务必编辑 backend/.env 填入真实配置！${NC}"
    echo ""
    echo "  需要填写的关键配置:"
    echo "  - FEISHU_APP_ID          (飞书应用 App ID)"
    echo "  - FEISHU_APP_SECRET      (飞书应用 App Secret)"
    echo "  - JWT_SECRET_KEY         (改为随机字符串)"
    echo "  - LLM_API_KEY            (大模型 API Key)"
    echo "  - EMBEDDING_API_KEY      (Embedding 模型 API Key)"
    echo "  - SUPER_ADMIN_OPEN_ID    (系统管理员飞书 open_id)"
    echo ""
    read -p "是否现在编辑 backend/.env? (y/n): " EDIT_ENV
    if [ "$EDIT_ENV" = "y" ] || [ "$EDIT_ENV" = "Y" ]; then
      if command -v nano &> /dev/null; then
        nano backend/.env
      else
        vi backend/.env
      fi
    fi
  else
    echo -e "${RED}错误: 未找到 backend/.env 和 backend/.env.example${NC}"
    exit 1
  fi
else
  echo "backend/.env 已存在"
fi

# 检查根目录 .env (docker-compose 前端构建参数)
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "${YELLOW}已从 .env.example 创建根目录 .env"
    echo -e "请编辑 .env 填入前端构建参数！${NC}"
    echo ""
    echo "  需要填写:"
    echo "  - VITE_FEISHU_APP_ID         (飞书 App ID，与 backend/.env 中相同)"
    echo "  - VITE_FEISHU_REDIRECT_URI   (改为 http://<服务器IP>/login)"
    echo ""
    read -p "是否现在编辑 .env? (y/n): " EDIT_ROOT_ENV
    if [ "$EDIT_ROOT_ENV" = "y" ] || [ "$EDIT_ROOT_ENV" = "Y" ]; then
      if command -v nano &> /dev/null; then
        nano .env
      else
        vi .env
      fi
    fi
  else
    echo -e "${YELLOW}警告: 未找到根目录 .env，前端飞书登录可能无法工作${NC}"
  fi
else
  echo "根目录 .env 已存在"
fi

# ---- 步骤 5: 构建并启动服务 ----
echo -e "${GREEN}[5/6] 构建并启动 Docker 服务 (首次构建可能需要 5-10 分钟)...${NC}"
docker compose down 2>/dev/null || true
docker compose up -d --build

# ---- 步骤 6: 等待并验证 ----
echo -e "${GREEN}[6/6] 等待服务启动...${NC}"
echo "等待数据库启动..."
sleep 5

# 等待后端健康检查通过 (最多等 60 秒)
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf http://localhost/health > /dev/null 2>&1; then
    break
  fi
  sleep 3
  WAITED=$((WAITED + 3))
  echo "  等待中... (${WAITED}s)"
done

echo ""
echo "======================================"
if curl -sf http://localhost/health > /dev/null 2>&1; then
  # 获取服务器公网 IP
  SERVER_IP=$(curl -sf http://ifconfig.me 2>/dev/null || curl -sf http://ip.sb 2>/dev/null || echo "<服务器IP>")
  echo -e "${GREEN}  部署成功！${NC}"
  echo ""
  echo "  访问地址: http://${SERVER_IP}"
  echo "  健康检查: http://${SERVER_IP}/health"
  echo "  API 文档: http://${SERVER_IP}/api/docs"
  echo ""
  echo "  注意: 首次使用请确保已在飞书开放平台配置:"
  echo "  OAuth 回调地址 = http://${SERVER_IP}/login"
else
  echo -e "${RED}  服务启动可能未完成，请检查日志:${NC}"
  echo ""
  echo "  查看所有日志: docker compose logs"
  echo "  查看后端日志: docker compose logs backend"
  echo "  查看数据库日志: docker compose logs postgres"
fi
echo "======================================"
echo ""
echo "常用运维命令:"
echo "  查看服务状态:  docker compose ps"
echo "  查看日志:      docker compose logs -f"
echo "  重启服务:      docker compose restart"
echo "  停止服务:      docker compose down"
echo "  更新并重启:    docker compose up -d --build"
