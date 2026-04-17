#!/bin/bash
set -e

# Ensure packages are on Python path
export PYTHONPATH="/home/site/wwwroot/.python_packages/lib/site-packages:$PYTHONPATH"

# Run database migrations
python manage.py migrate --noinput

# Start Gunicorn
python -m gunicorn pokeshop.wsgi:application --bind=0.0.0.0:8000 --timeout=600
