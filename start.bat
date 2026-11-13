@echo off
setlocal enabledelayedexpansion

title VertexLearn AI - Launcher
cd /d "%~dp0"

echo ===================================================
echo              VertexLearn AI Launcher
echo ===================================================
echo.

:: 1. Check for .env file
if not exist ".env" (
    echo [!] .env file not found.
    if exist ".env.example" (
        echo [*] Copying .env.example to .env...
        copy .env.example .env >nul
        echo [!] Please verify your .env configuration if needed.
    ) else (
        echo [ERROR] Neither .env nor .env.example was found!
        pause
        exit /b 1
    )
)

:: 2. Check Node.js installation
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node 24 LTS and try again.
    pause
    exit /b 1
)

:: 3. Check Docker Desktop
echo [*] Checking Docker engine status...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Docker daemon is not active. Attempting to launch Docker Desktop...
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    )
    echo [*] Waiting for Docker to start (this may take 20-30 seconds)...
    set /a attempts=0
    :wait_docker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% equ 0 goto docker_ready
    set /a attempts+=1
    if !attempts! geq 20 (
        echo [ERROR] Timed out waiting for Docker engine. Please ensure Docker Desktop is running and try again.
        pause
        exit /b 1
    )
    goto wait_docker
)

:docker_ready
echo [OK] Docker daemon is running.
echo.

:: 4. Start Docker Compose foundation services (PostgreSQL 17 + Redis 7.4)
echo [*] Starting PostgreSQL and Redis containers...
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start Docker Compose services!
    pause
    exit /b 1
)
echo [OK] Database and cache containers are healthy.
echo.

:: 5. Run Database Migrations
echo [*] Running database migrations...
call npm run db:migrate
if %errorlevel% neq 0 (
    echo [ERROR] Database migration failed!
    pause
    exit /b 1
)
echo [OK] Migrations applied.
echo.

:: 6. Seed Baseline Data and Demo Course
echo [*] Ensuring database seeds and demo course are present...
call npm run db:seed
call npm run demo:seed
echo.

:: 7. Start Backend API Server in a dedicated window
echo [*] Launching Backend API (port 3000)...
start "VertexLearn Backend API" cmd /c "title VertexLearn Backend API && npm run dev:api"

:: 8. Start Frontend Web Server in a dedicated window
echo [*] Launching Frontend Web (port 5173)...
start "VertexLearn Frontend Web" cmd /c "title VertexLearn Frontend Web && npm run dev:web"

:: 9. Wait for servers to spin up
echo [*] Waiting for servers to initialize...
timeout /t 4 /nobreak >nul

:: 10. Open web app in default browser
echo [*] Opening VertexLearn AI in your browser...
start http://127.0.0.1:5173

echo.
echo ===================================================
echo          VertexLearn AI is up and running!
echo ===================================================
echo.
echo Web UI:      http://127.0.0.1:5173
echo API Health:  http://127.0.0.1:3000/health/ready
echo.
echo Demo Accounts (password from .env DEMO_PASSWORD):
echo   - Student:    student@vertexlearn.test
echo   - Instructor: instructor@vertexlearn.test
echo   - Admin:      admin@vertexlearn.test
echo.
echo Press any key to stop all Docker containers and exit...
echo (Or close the individual API / Web windows to stop servers)
echo ===================================================
pause >nul

echo.
echo [*] Stopping Docker containers...
docker compose --env-file .env -f infra/docker-compose.yml stop
echo [OK] All done.

