@echo off
title VertexLearn AI - Shutdown
cd /d "%~dp0"

echo ===================================================
echo             VertexLearn AI - Shutdown
echo ===================================================
echo.

echo [*] Stopping Docker containers...
docker compose --env-file .env -f infra/docker-compose.yml stop

echo [*] Closing Node.js dev server processes...
taskkill /F /FI "WINDOWTITLE eq VertexLearn Backend API*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq VertexLearn Frontend Web*" >nul 2>&1

echo.
echo [OK] All VertexLearn AI services stopped.
timeout /t 2 /nobreak >nul

