@echo off
chcp 65001 >nul 2>&1
title 流光数据平台 - 启动中...

echo ============================================
echo    流光 (Liuguang) 智能数据资产平台
echo ============================================
echo.

REM 绕过代理访问 localhost
set NO_PROXY=localhost,127.0.0.1
set no_proxy=localhost,127.0.0.1

REM 1. 检查 Docker Desktop 是否运行
echo [1/3] 检查 Docker Desktop ...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [错误] Docker Desktop 未运行！
    echo 请先启动 Docker Desktop，然后重新运行此脚本。
    echo.
    pause
    exit /b 1
)
echo       Docker Desktop 已就绪。

REM 2. 加载前端飞书配置（供 docker compose 构建参数使用）
if exist "frontend\.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("frontend\.env") do (
        if not "%%a"=="" set "%%a=%%b"
    )
)

REM 3. 启动所有容器
echo.
echo [2/3] 启动容器 (docker compose up --build -d) ...
echo       首次构建可能需要几分钟，请耐心等待...
echo.
docker compose up --build -d
if %errorlevel% neq 0 (
    echo.
    echo [错误] Docker Compose 启动失败！请检查上方错误信息。
    echo.
    pause
    exit /b 1
)

REM 4. 等待后端就绪
echo.
echo [3/3] 等待后端服务就绪 ...

set /a count=0
set /a max_count=40

:wait_loop
if %count% geq %max_count% (
    echo.
    echo [警告] 等待超时，后端可能尚未完全启动。
    echo       你可以稍后手动访问 http://localhost
    goto open_browser
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8000/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    set /a seconds=%count% * 3
    echo       后端已就绪！
    goto open_browser
)

set /a count+=1
timeout /t 3 /nobreak >nul
goto wait_loop

:open_browser
echo.
echo ============================================
echo   平台已启动！正在打开浏览器...
echo.
echo   前端:    http://localhost
echo   后端:    http://localhost:8000
echo   API文档: http://localhost:8000/docs
echo ============================================
echo.

start "" "http://localhost"

title 流光数据平台 - 运行中
echo 按任意键关闭此窗口（服务将继续在后台运行）...
pause >nul
