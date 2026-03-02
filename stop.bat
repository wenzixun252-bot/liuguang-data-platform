@echo off
chcp 65001 >nul 2>&1
title 流光数据平台 - 停止中...

echo ============================================
echo   流光 (Liuguang) 智能数据资产平台 - 停止
echo ============================================
echo.

echo 正在停止所有容器...
echo.
docker compose down
echo.

if %errorlevel% equ 0 (
    echo ============================================
    echo   所有服务已停止。
    echo ============================================
) else (
    echo [警告] 停止过程中可能出现问题，请检查上方信息。
)

echo.
echo 按任意键关闭此窗口...
pause >nul
