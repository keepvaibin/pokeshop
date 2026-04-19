@echo off
REM ─────────────────────────────────────────────────
REM  start-dev.bat  –  Launch Django + Next.js locally
REM  Runs backend on :8000 and frontend on :3000
REM  Expects: backend/ and frontend/ subfolders (main branch layout)
REM ─────────────────────────────────────────────────

set ROOT=%~dp0

REM ── Validate prerequisites ────────────────────────
if not exist "%ROOT%.venv\Scripts\activate.bat" (
    echo ERROR: .venv not found at %ROOT%.venv
    echo Run:  python -m venv .venv
    echo Then: .venv\Scripts\activate ^& pip install -r backend\requirements.txt
    pause
    exit /b 1
)

if not exist "%ROOT%backend\manage.py" (
    echo ERROR: backend\manage.py not found.
    echo Make sure you are on the 'main' branch.
    pause
    exit /b 1
)

if not exist "%ROOT%frontend\package.json" (
    echo ERROR: frontend\package.json not found.
    echo Run:  cd frontend ^& npm install
    pause
    exit /b 1
)

REM ── Kill any leftover servers ─────────────────────
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im node.exe   >nul 2>&1

REM ── Backend (Django) ──────────────────────────────
start "Django Backend [:8000]" cmd /k "cd /d %ROOT%backend && call %ROOT%.venv\Scripts\activate.bat && python manage.py migrate --noinput && python manage.py runserver 0.0.0.0:8000"

REM Give the backend a moment to start before Next.js dev server
timeout /t 4 /nobreak >nul

REM ── Frontend (Next.js) ────────────────────────────
start "Next.js Frontend [:3000]" cmd /k "cd /d %ROOT%frontend && npm run dev"

echo.
echo  ================================================
echo   Backend   -^>  http://localhost:8000
echo   Frontend  -^>  http://localhost:3000
echo   Admin     -^>  http://localhost:8000/admin/
echo  ================================================
echo.
echo  Close either server window to stop it.
echo   Frontend -^>  http://localhost:3000
echo  ================================================
echo.
echo   Close the two spawned windows to stop.
echo.
