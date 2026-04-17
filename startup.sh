#!/bin/bash
# Azure App Service startup command for Django backend.
# GitHub-Heavy Build approach: all dependencies and static files
# are pre-built on GitHub and shipped as a ready-to-run package.
#
# Azure Portal Configuration Required:
# - General Settings > Startup Command: bash startup.sh
# - Environment Variables:
#   WEBSITE_RUN_FROM_PACKAGE=1 (enables read-only deployment)
#   DELETE SCM_DO_BUILD_DURING_DEPLOYMENT (we build on GitHub, not Azure)

set -e

# Add our pre-built packages to Python path
# GitHub installed all dependencies into .python_packages during build
export PYTHONPATH=$PYTHONPATH:/home/site/wwwroot/.python_packages/lib/site-packages

# Apply database migrations (writes to DB, not filesystem, so it's safe)
python manage.py migrate --noinput

# Start Gunicorn using python -m to ensure it uses our PYTHONPATH
# Static files were already collected on GitHub, so we skip collectstatic
python -m gunicorn pokeshop.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers 4 \
  --timeout 600 \
  --access-logfile '-' \
  --error-logfile '-' \
  --log-level info
