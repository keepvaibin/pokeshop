#!/bin/bash
set -e

# Apply database updates
python manage.py migrate --noinput

# Refresh static assets for newly deployed builds
python manage.py collectstatic --noinput

# Create the shared throttle cache table (idempotent; safe on restart)
python manage.py createcachetable

# Start Gunicorn (Oryx activates the antenv virtualenv automatically)
WEB_CONCURRENCY="${WEB_CONCURRENCY:-3}"
GUNICORN_THREADS="${GUNICORN_THREADS:-2}"
GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-120}"

python -m gunicorn \
	--bind=0.0.0.0:8000 \
	--workers="$WEB_CONCURRENCY" \
	--threads="$GUNICORN_THREADS" \
	--timeout="$GUNICORN_TIMEOUT" \
	--access-logfile - \
	--error-logfile - \
	pokeshop.wsgi:application
