import logging
import os
import sys

from django.apps import AppConfig

logger = logging.getLogger(__name__)


class InventoryConfig(AppConfig):
    name = 'inventory'

    def ready(self):
        import inventory.signals  # noqa: F401
        self._start_tcg_price_scheduler()

    # ------------------------------------------------------------------ #
    #  Daily TCG price sync scheduler (APScheduler)                       #
    # ------------------------------------------------------------------ #
    @staticmethod
    def _start_tcg_price_scheduler():
        """Start a background scheduler that runs sync_tcg_prices every 24 h.

        Guards:
        - Skip when running management commands that don't need it
        - Skip in the second Gunicorn worker process (RUN_MAIN / SERVER_RUNNING)
        """
        _SKIP_COMMANDS = {
            'migrate', 'makemigrations', 'shell', 'test', 'collectstatic',
            'check', 'inspectdb', 'dbshell', 'sync_tcg_prices',
        }
        argv_cmd = sys.argv[1] if len(sys.argv) > 1 else ''
        if argv_cmd in _SKIP_COMMANDS:
            return
        # Avoid double-starting in Gunicorn/runserver reload processes
        if os.environ.get('RUN_MAIN') == 'true' or os.environ.get('SERVER_RUNNING'):
            return
        os.environ['SERVER_RUNNING'] = 'true'

        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.interval import IntervalTrigger
            from django.core.management import call_command

            def _run_sync():
                logger.info('APScheduler: starting daily TCG price sync …')
                try:
                    call_command('sync_tcg_prices')
                    logger.info('APScheduler: daily TCG price sync complete.')
                except Exception as exc:
                    logger.exception('APScheduler: TCG price sync failed: %s', exc)

            scheduler = BackgroundScheduler()
            scheduler.add_job(
                _run_sync,
                trigger=IntervalTrigger(hours=24),
                id='tcg_price_sync',
                replace_existing=True,
                misfire_grace_time=3600,
            )
            scheduler.start()
            logger.info('Scheduled daily TCG price sync (every 24 h).')
        except ImportError:
            logger.warning('apscheduler not installed — daily TCG price sync will NOT run automatically.')
        except Exception as exc:
            logger.exception('Failed to start TCG price sync scheduler: %s', exc)
