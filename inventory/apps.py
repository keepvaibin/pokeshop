import logging
import os
import sys
from datetime import datetime, timedelta, timezone as dt_tz

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
        """Start a background scheduler that runs sync_tcg_prices after TCGCSV updates.

        Guards:
        - Skip when running management commands that don't need it
        - Skip outside web server processes
        - Skip in duplicate runserver/Gunicorn processes (RUN_MAIN / SERVER_RUNNING)
        """
        _SKIP_COMMANDS = {
            'migrate', 'makemigrations', 'shell', 'test', 'collectstatic',
            'check', 'inspectdb', 'dbshell', 'sync_tcg_prices',
        }
        argv_cmd = sys.argv[1] if len(sys.argv) > 1 else ''
        if argv_cmd in _SKIP_COMMANDS:
            return
        argv_text = ' '.join(sys.argv).lower()
        is_web_process = argv_cmd == 'runserver' or 'gunicorn' in argv_text or os.environ.get('WEBSITE_SITE_NAME')
        if not is_web_process:
            return
        # Avoid double-starting in Gunicorn/runserver reload processes
        if os.environ.get('RUN_MAIN') == 'true' or os.environ.get('SERVER_RUNNING'):
            return
        os.environ['SERVER_RUNNING'] = 'true'

        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.cron import CronTrigger
            from apscheduler.triggers.date import DateTrigger
            from django.core.cache import cache
            from django.core.management import call_command
            from django.db.utils import OperationalError, ProgrammingError

            def _latest_tcg_update_boundary():
                now_utc = datetime.now(dt_tz.utc)
                boundary = now_utc.replace(hour=20, minute=20, second=0, microsecond=0)
                if now_utc < boundary:
                    boundary -= timedelta(days=1)
                return boundary

            def _should_run_startup_sync():
                try:
                    from inventory.models import TCGCardPrice
                    newest_sync = TCGCardPrice.objects.order_by('-updated_at').values_list('updated_at', flat=True).first()
                    if newest_sync is None:
                        return True
                    return newest_sync.astimezone(dt_tz.utc) < _latest_tcg_update_boundary()
                except (OperationalError, ProgrammingError):
                    return False

            def _run_sync():
                lock_key = 'tcg_price_sync:running'
                try:
                    lock_acquired = cache.add(lock_key, '1', timeout=60 * 60 * 4)
                except Exception:
                    lock_acquired = True
                if not lock_acquired:
                    logger.info('APScheduler: TCG price sync already running; skipping duplicate job.')
                    return

                logger.info('APScheduler: starting TCG price sync.')
                try:
                    call_command('sync_tcg_prices')
                    logger.info('APScheduler: TCG price sync complete.')
                except Exception as exc:
                    logger.exception('APScheduler: TCG price sync failed: %s', exc)
                finally:
                    try:
                        cache.delete(lock_key)
                    except Exception:
                        pass

            def _run_startup_sync_if_needed():
                if _should_run_startup_sync():
                    _run_sync()

            scheduler = BackgroundScheduler()
            scheduler.add_job(
                _run_sync,
                trigger=CronTrigger(hour=20, minute=20, timezone=dt_tz.utc),
                id='tcg_price_sync',
                replace_existing=True,
                misfire_grace_time=3600,
                coalesce=True,
                max_instances=1,
            )
            scheduler.add_job(
                _run_startup_sync_if_needed,
                trigger=DateTrigger(run_date=datetime.now(dt_tz.utc) + timedelta(seconds=30)),
                id='tcg_price_sync_startup_backfill',
                replace_existing=True,
                misfire_grace_time=3600,
                max_instances=1,
            )
            scheduler.start()
            logger.info('Scheduled TCG price sync daily at 20:20 UTC with startup stale-data backfill.')
        except ImportError:
            logger.warning('apscheduler not installed — daily TCG price sync will NOT run automatically.')
        except Exception as exc:
            logger.exception('Failed to start TCG price sync scheduler: %s', exc)
