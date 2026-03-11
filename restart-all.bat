@echo off
title Liuguang - Restart All Services
chcp 65001 >nul 2>&1

echo ============================================
echo   Liuguang - Restart All Services
echo ============================================
echo.

set "NO_PROXY=localhost,127.0.0.1"
set "no_proxy=localhost,127.0.0.1"

echo [1/4] Checking Docker Desktop ...
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

echo [2/4] Rebuilding all services (backend + frontend) ...
echo       This may take a few minutes ...
echo.
docker compose up -d --build backend frontend
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed! Check the error above.
    echo.
    pause
    exit /b 1
)
echo.

echo [3/4] Waiting for backend to be ready ...
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
    goto check_frontend
)

set /a count=count+1
timeout /t 2 /nobreak >nul
goto wait_loop

:check_frontend
echo.
echo [4/4] Checking frontend ...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    echo       Frontend is ready!
) else (
    echo       [WARN] Frontend not responding yet, it may need a moment.
)

:finish
echo.
echo ============================================
echo   All services restarted successfully!
echo.
echo   Frontend: http://localhost
echo   Backend:  http://localhost:8000
echo   API Doc:  http://localhost:8000/docs
echo ============================================
echo.
echo Press any key to close ...
pause >nul
