@echo off
REM ─────────────────────────────────────────────────
REM  start-dev.bat  –  Launch Django + Next.js locally
REM  Runs backend on :8000 and frontend on :3000
REM  Expects: manage.py at repo root + frontend app (frontend/ or ../pokeshop-web)
REM ─────────────────────────────────────────────────

set ROOT=%~dp0
set "FRONTEND_DIR="

REM ── Validate prerequisites ────────────────────────
if not exist "%ROOT%.venv\Scripts\activate.bat" (
    echo ERROR: .venv not found at %ROOT%.venv
    echo Run:  python -m venv .venv
    echo Then: .venv\Scripts\activate ^& pip install -r requirements.txt
    pause
    exit /b 1
)

if not exist "%ROOT%manage.py" (
    echo ERROR: manage.py not found at repo root.
    pause
    exit /b 1
)

if exist "%ROOT%frontend\package.json" (
    set "FRONTEND_DIR=%ROOT%frontend"
) else if exist "%ROOT%..\pokeshop-web\package.json" (
    set "FRONTEND_DIR=%ROOT%..\pokeshop-web"
)

if "%FRONTEND_DIR%"=="" (
    echo ERROR: frontend package.json not found.
    echo Checked:
    echo   - %ROOT%frontend\package.json
    echo   - %ROOT%..\pokeshop-web\package.json
    echo.
    echo Run one of:
    echo   cd frontend ^& npm install
    echo   cd ..\pokeshop-web ^& npm install
    pause
    exit /b 1
)

REM ── Kill any leftover servers ─────────────────────
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im node.exe   >nul 2>&1

REM ── Backend (Django) ──────────────────────────────
start "Django Backend [:8000]" cmd /k "cd /d %ROOT% && call %ROOT%.venv\Scripts\activate.bat && pip install -r requirements.txt && python manage.py migrate --noinput && python manage.py createcachetable && python manage.py runserver 0.0.0.0:8000"

REM Give the backend a moment to start before Next.js dev server
timeout /t 4 /nobreak >nul

REM ── Frontend (Next.js) ────────────────────────────
start "Next.js Frontend [:3000]" cmd /k "cd /d %FRONTEND_DIR% && npm install && npm run dev"

echo.
echo  ================================================
echo   Backend   -^>  http://localhost:8000
echo   Frontend  -^>  http://localhost:3000
echo   Admin     -^>  http://localhost:8000/admin/
echo  ================================================
echo.
echo  Close the two spawned windows to stop.
echo.
