#!/bin/bash
# Azure App Service startup command for the Django backend.
# Set this as the "Startup Command" in the Azure portal, or pass it directly
# to the App Service configuration.
#
# Usage (Azure portal > Configuration > General settings > Startup Command):
#   bash startup.sh
#
# Alternatively, set the startup command directly to:
#   gunicorn pokeshop.wsgi:application --bind 0.0.0.0:8000 --workers 4 --timeout 120

set -e

cd /home/site/wwwroot

# Collect static files on startup (idempotent)
python manage.py collectstatic --noinput

# Apply any pending migrations
python manage.py migrate --noinput

# Start Gunicorn
exec gunicorn pokeshop.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers 4 \
  --timeout 120 \
  --access-logfile '-' \
  --error-logfile '-'
