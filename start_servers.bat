@echo off
echo Stopping any existing servers...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
echo Clearing Next.js image cache...
if exist "c:\Users\vaibh\Documents\pokeshop\frontend\.next\cache\images" (
    rmdir /s /q "c:\Users\vaibh\Documents\pokeshop\frontend\.next\cache\images"
)
echo Starting UCSC Pokeshop Servers...
start "Django Backend" cmd /k "cd /d c:\Users\vaibh\Documents\pokeshop\backend && c:\Users\vaibh\Documents\pokeshop\.venv\Scripts\activate && python manage.py runserver"
start "NextJS Frontend" cmd /k "cd /d c:\Users\vaibh\Documents\pokeshop\frontend && npm run dev"
echo You can close the two new windows to stop the servers.