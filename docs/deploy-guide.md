# 流光数据平台 - 部署指南 (面向小白)

本指南手把手教你把流光平台部署到阿里云服务器上。即使你没有服务器运维经验，跟着每一步做就能成功。

---

## 第一步：购买阿里云服务器

### 1.1 注册并登录阿里云

1. 打开 https://www.aliyun.com
2. 注册账号（如果没有）并完成实名认证

### 1.2 购买 ECS 云服务器

1. 进入阿里云控制台，搜索 "ECS" 或 "云服务器"
2. 点击 "创建实例"，按以下配置选择：

| 配置项 | 推荐选择 |
|--------|----------|
| 付费模式 | 按量付费（先试用）或包年包月（更便宜） |
| 地域 | 选离你近的（如华东1-杭州） |
| 实例规格 | 经济型 e 实例，2核2G（约 50-80 元/月） |
| 操作系统 | Ubuntu 22.04 64位 |
| 系统盘 | 40G SSD 云盘 |
| 公网 IP | 勾选"分配公网IPv4地址" |
| 带宽 | 按使用流量计费，选 5Mbps |
| 登录凭证 | 设置密码（记住你设的密码！） |

3. 确认订单，完成购买
4. 在 ECS 控制台找到你的服务器，记下**公网 IP 地址**（类似 `47.100.xxx.xxx`）

### 1.3 配置安全组（开放端口）

这一步很重要！不开端口的话外面访问不了。

1. 在 ECS 控制台，点击你的实例 -> "安全组"
2. 点击 "配置规则" -> "手动添加"
3. 添加以下规则：

| 方向 | 协议 | 端口范围 | 授权对象 | 说明 |
|------|------|----------|----------|------|
| 入方向 | TCP | 80 | 0.0.0.0/0 | 网页访问 |
| 入方向 | TCP | 22 | 0.0.0.0/0 | SSH 远程登录 |

> 22 端口通常默认已开放。80 端口一定要手动添加！

---

## 第二步：连接到服务器

### Windows 用户

1. 下载并安装 [MobaXterm](https://mobaxterm.mobatek.net/download.html)（免费版就够了）
2. 打开 MobaXterm，点击 "Session" -> "SSH"
3. 填写：
   - Remote host: `你的服务器公网IP`
   - Username: `root`
4. 点击 OK，输入你购买时设置的密码
5. 看到 `root@xxx:~#` 的命令行，说明连接成功！

### Mac 用户

1. 打开 "终端" 应用
2. 输入：`ssh root@你的服务器公网IP`
3. 输入密码，连接成功

---

## 第三步：上传项目代码

### 方式 A：直接从 Git 拉取（推荐）

如果你的代码已经推送到 Git 仓库（GitHub/Gitee），在服务器上执行：

```bash
# 安装 git
apt-get update && apt-get install -y git

# 拉取代码（替换为你的仓库地址）
cd /opt
git clone https://你的仓库地址.git liuguang-data-platform
cd liuguang-data-platform
```

### 方式 B：手动上传文件

如果没有 Git 仓库，用 MobaXterm 的文件面板：

1. MobaXterm 左侧有文件浏览器，导航到 `/opt/`
2. 创建文件夹 `liuguang-data-platform`
3. 把本地项目文件全部拖进去

或者用命令行打包上传：

```bash
# 在你的电脑上（不是服务器），打包项目
# 排除 node_modules 和 .env 等敏感文件
tar -czf liuguang.tar.gz --exclude=node_modules --exclude=.env --exclude=__pycache__ -C /d/CC liuguang-data-platform

# 上传到服务器 (Windows 用 MobaXterm 拖拽更简单)
scp liuguang.tar.gz root@服务器IP:/opt/

# 在服务器上解压
cd /opt
tar -xzf liuguang.tar.gz
cd liuguang-data-platform
```

---

## 第四步：配置环境变量

这是最关键的一步，需要把你的飞书凭证和 API Key 填进配置文件。

### 4.1 配置后端环境变量

```bash
cd /opt/liuguang-data-platform

# 从模板创建配置文件
cp backend/.env.example backend/.env

# 编辑配置文件
nano backend/.env
```

**需要修改的关键项**（其他保持默认即可）：

```
FEISHU_APP_ID=cli_你的飞书应用ID
FEISHU_APP_SECRET=你的飞书应用Secret
SUPER_ADMIN_OPEN_ID=ou_你的飞书openid
JWT_SECRET_KEY=随便敲一串长字符比如abc123xyz456qwerty789
LLM_API_KEY=你的大模型API密钥
EMBEDDING_API_KEY=你的Embedding模型API密钥
```

编辑完成后按 `Ctrl+O` 保存，`Ctrl+X` 退出。

> **如何获取飞书 App ID 和 Secret？**
> 1. 打开飞书开放平台: https://open.feishu.cn
> 2. 进入你的自建应用 -> "凭证与基础信息"
> 3. 复制 App ID 和 App Secret

### 4.2 配置前端环境变量

```bash
# 从模板创建
cp .env.example .env

# 编辑
nano .env
```

修改内容：

```
VITE_FEISHU_APP_ID=cli_你的飞书应用ID
VITE_FEISHU_REDIRECT_URI=http://你的服务器IP/login
```

> 把 `你的服务器IP` 替换为实际的公网 IP，比如 `http://47.100.123.45/login`

保存并退出。

---

## 第五步：配置飞书应用

在飞书开放平台配置 OAuth 回调地址，否则登录会失败。

1. 打开 https://open.feishu.cn -> 进入你的自建应用
2. 左侧菜单 -> "安全设置"
3. 在 "重定向 URL" 中添加：`http://你的服务器IP/login`
4. 保存

另外确认应用已开通以下权限：
- 获取用户基本信息
- 获取用户邮箱信息
- 访问多维表格（如果要用 ETL 功能）
- 访问日历（如果要用日程管家功能）

---

## 第六步：一键启动！

```bash
cd /opt/liuguang-data-platform

# 给部署脚本执行权限
chmod +x deploy.sh

# 运行一键部署
sudo bash deploy.sh
```

脚本会自动：
1. 安装 Docker（如果没有）
2. 配置国内镜像加速
3. 构建前端和后端镜像
4. 启动 PostgreSQL + 后端 + 前端三个服务
5. 等待并验证服务是否正常

**首次构建需要 5-10 分钟**，请耐心等待。

看到 "部署成功！" 的绿色提示就说明一切顺利！

---

## 第七步：验证

1. 在浏览器中打开 `http://你的服务器IP`
2. 应该看到流光平台的登录页面
3. 点击飞书登录，完成授权
4. 成功进入数据洞察看板

如果有问题，查看日志：

```bash
# 查看所有服务日志
docker compose logs

# 只看后端日志
docker compose logs backend

# 实时跟踪日志
docker compose logs -f backend
```

---

## 常见问题

### Q: 浏览器打不开，显示无法访问

1. 确认安全组已开放 80 端口
2. 确认服务在运行：`docker compose ps`（三个服务都应显示 "Up"）
3. 确认防火墙：`ufw status`，如果是 active，执行 `ufw allow 80/tcp`

### Q: 飞书登录跳转后显示错误

1. 确认飞书开放平台的重定向 URL 配置正确：`http://IP/login`
2. 确认 `backend/.env` 中的 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 正确
3. 确认 `.env` 中的 `VITE_FEISHU_REDIRECT_URI` 与飞书平台配置一致

### Q: 登录成功但页面空白或报错

1. 查看后端日志：`docker compose logs backend`
2. 常见原因：数据库迁移失败、API Key 未配置
3. 尝试重启：`docker compose restart backend`

### Q: 怎么更新代码？

```bash
cd /opt/liuguang-data-platform

# 如果是 Git 拉取的
git pull

# 重新构建并启动
docker compose up -d --build
```

### Q: 怎么备份数据库？

```bash
# 导出数据库
docker compose exec postgres pg_dump -U postgres liuguang > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker compose exec -T postgres psql -U postgres liuguang < backup_20260311.sql
```

### Q: 服务器重启后怎么恢复？

Docker 服务设置了 `restart: unless-stopped`，服务器重启后会自动恢复。如果没有自动启动：

```bash
cd /opt/liuguang-data-platform
docker compose up -d
```

---

## 运维速查表

| 操作 | 命令 |
|------|------|
| 查看服务状态 | `docker compose ps` |
| 查看日志 | `docker compose logs -f` |
| 重启所有服务 | `docker compose restart` |
| 重启某个服务 | `docker compose restart backend` |
| 停止所有服务 | `docker compose down` |
| 更新并重启 | `docker compose up -d --build` |
| 进入数据库 | `docker compose exec postgres psql -U postgres liuguang` |
| 备份数据库 | `docker compose exec postgres pg_dump -U postgres liuguang > backup.sql` |
| 查看磁盘使用 | `df -h` |
| 清理 Docker 缓存 | `docker system prune -f` |
