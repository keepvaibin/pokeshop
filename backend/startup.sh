#!/bin/bash
set -e

# Run database migrations
python manage.py migrate --noinput

# Start Gunicorn (Oryx activates the antenv virtualenv automatically)
python -m gunicorn --bind=0.0.0.0:8000 --timeout 600 pokeshop.wsgi:application
