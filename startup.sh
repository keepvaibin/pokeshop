#!/bin/bash
set -e

# Ensure packages are on Python path.
# Oryx already exports PYTHONPATH for __oryx_packages__ when it finds the directory,
# but we set it explicitly here as a belt-and-suspenders fallback.
export PYTHONPATH="/home/site/wwwroot/__oryx_packages__/lib/site-packages:$PYTHONPATH"

# Run database migrations
python manage.py migrate --noinput

# Start Gunicorn
python -m gunicorn pokeshop.wsgi:application --bind=0.0.0.0:8000 --timeout=600
