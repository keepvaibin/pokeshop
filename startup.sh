#!/bin/bash
set -e

# Apply database updates
python manage.py migrate --noinput

# Refresh static assets for newly deployed builds
python manage.py collectstatic --noinput

# Create the shared throttle cache table (idempotent; safe on restart)
python manage.py createcachetable

# Start Gunicorn (Oryx activates the antenv virtualenv automatically)
python -m gunicorn --bind=0.0.0.0:8000 --timeout 600 pokeshop.wsgi:application
