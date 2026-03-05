@echo off
chcp 65001 >nul 2>&1
title 流光平台 - 重启后端

set NO_PROXY=localhost,127.0.0.1
set no_proxy=localhost,127.0.0.1

echo [1/2] 重建并重启后端容器...
docker compose up -d --build backend
if %errorlevel% neq 0 (
    echo [错误] 重启失败！
    pause
    exit /b 1
)

echo.
echo [2/2] 等待后端就绪...
set /a count=0
:wait_loop
if %count% geq 20 (
    echo [警告] 等待超时
    goto done
)
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8000/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto done
set /a count+=1
timeout /t 2 /nobreak >nul
goto wait_loop

:done
echo.
echo 后端已重启完成！
echo.
pause
