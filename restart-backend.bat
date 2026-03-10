@echo off
title Liuguang - Restart Backend

echo ============================================
echo   Liuguang - Restart Backend
echo ============================================
echo.

set "NO_PROXY=localhost,127.0.0.1"
set "no_proxy=localhost,127.0.0.1"

echo [1/3] Checking Docker Desktop ...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Docker Desktop is not running!
    echo Please start Docker Desktop first.
    echo.
    pause
    exit /b 1
)
echo       Docker Desktop is ready.
echo.

echo [2/3] Rebuilding and restarting backend ...
echo.
docker compose up -d --build backend
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Restart failed! Check the error above.
    echo.
    pause
    exit /b 1
)
echo.

echo [3/3] Waiting for backend to be ready ...
set count=0
set max_count=30

:wait_loop
if %count% geq %max_count% (
    echo.
    echo [WARN] Timeout after 60s. Backend may not be fully started.
    goto finish
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8000/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    echo       Backend is ready!
    goto finish
)

set /a count=count+1
timeout /t 2 /nobreak >nul
goto wait_loop

:finish
echo.
echo ============================================
echo   Backend restarted successfully!
echo.
echo   Backend: http://localhost:8000
echo   API Doc: http://localhost:8000/docs
echo ============================================
echo.
echo Press any key to close ...
pause >nul
