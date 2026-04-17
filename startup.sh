#!/bin/bash
# Azure App Service startup command for Django backend.
# This script uses explicit Python paths to ensure the Oryx-built
# virtual environment is used correctly.
#
# Azure Portal Configuration Required:
# - General Settings > Startup Command: bash startup.sh
# - Environment Variables:
#   SCM_DO_BUILD_DURING_DEPLOYMENT=true
#   WEBSITE_RUN_FROM_PACKAGE=0

set -e

# Use the absolute path to Python in the Oryx-built virtual environment.
# This bypasses PATH issues and ensures Django and all dependencies are available.
PYTHON_BIN="/home/site/wwwroot/antenv/bin/python"
GUNICORN_BIN="/home/site/wwwroot/antenv/bin/gunicorn"

# Fallback to system Python if venv doesn't exist (shouldn't happen with proper Oryx build)
if [ ! -f "$PYTHON_BIN" ]; then
    echo "WARNING: Oryx venv not found at $PYTHON_BIN, falling back to system python"
    PYTHON_BIN="python"
    GUNICORN_BIN="gunicorn"
fi

# Collect static files (idempotent)
$PYTHON_BIN manage.py collectstatic --noinput

# Apply database migrations
$PYTHON_BIN manage.py migrate --noinput

# Start Gunicorn using the configuration file for optimized settings
exec $GUNICORN_BIN pokeshop.wsgi:application -c gunicorn.conf.py
