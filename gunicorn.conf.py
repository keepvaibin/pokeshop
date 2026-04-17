"""
Gunicorn configuration for Django WSGI application on Azure App Service.
Optimized for production deployment with Azure's infrastructure.
"""
import multiprocessing
import os

# Bind to all interfaces on port 8000 (Azure standard)
bind = "0.0.0.0:8000"

# Worker configuration
# Azure recommendation: (num_cpus * 2) + 1 workers
num_cpus = multiprocessing.cpu_count()
workers = (num_cpus * 2) + 1
threads = 1 if num_cpus == 1 else 2
worker_class = "gthread"  # Thread-based workers for Django

# Timeout settings
# Azure health probe timeout is 230s, set worker timeout accordingly
timeout = 600
graceful_timeout = 120
keepalive = 5

# Logging
accesslog = "-"  # Log to stdout
errorlog = "-"   # Log to stderr  
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")

# Request handling
max_requests = 1000          # Restart workers after N requests (prevents memory leaks)
max_requests_jitter = 50     # Add randomness to prevent thundering herd

# Performance tuning
preload_app = False  # Don't preload (better for Azure's health probes)
worker_tmp_dir = "/dev/shm"  # Use shared memory for better performance
