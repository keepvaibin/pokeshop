import asyncio
import logging
from dataclasses import dataclass, field
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.db.models import Q
from django.utils import timezone

from .pickup_channels import (
    PACIFIC_TZ,
    PICKUP_CATEGORY_ID,
    ROLLING_WINDOW_DAYS,
    _fetch_live_roles,
    _find_by_name,
    cleanup_expired_pickup_infrastructure,
    ensure_rolling_window,
    pacific_today,
    pickup_role_name,
    rolling_pickup_dates,
)

logger = logging.getLogger(__name__)

PICKUP_ROLE_PREFIX = 'Pickup: '
DEFAULT_BATCH_SIZE = 25
MAX_ATTEMPTS = 3
PROCESSING_TIMEOUT_SECONDS = 300
MUTATION_SLEEP_SECONDS = 0.5
BOOT_RETRY_SECONDS = 300

_BOOT_SYNC_COMPLETED_GUILDS = set()
_BOOT_SYNC_RUNNING_GUILDS = set()


@dataclass
class PickupRoleProcessResult:
    claimed: int = 0
    processed: int = 0
    ignored: int = 0
    warnings: int = 0
    failed: int = 0
    dead_lettered: int = 0
    errors: list[str] = field(default_factory=list)


def _django_setting(name, default=None):
    try:
        from django.conf import settings
        return getattr(settings, name, default)
    except Exception:
        return default


def _discord_exception_code(exc):
    return getattr(exc, 'code', None)


def _is_discord_not_found(exc):
    return exc.__class__.__name__ == 'NotFound' or getattr(exc, 'status', None) == 404


def _is_discord_forbidden(exc):
    return exc.__class__.__name__ == 'Forbidden' or getattr(exc, 'status', None) == 403


def _is_discord_role_cap(exc):
    return _discord_exception_code(exc) == 30005


def _event_key(event):
    return event.discord_id, event.pickup_date


def collapse_canceling_events(events):
    pending_grants = {}
    canceled_ids = set()
    for event in events:
        key = _event_key(event)
        if event.event_type == 'GRANT':
            pending_grants.setdefault(key, []).append(event)
            continue
        if event.event_type == 'REVOKE' and pending_grants.get(key):
            grant = pending_grants[key].pop()
            canceled_ids.update({grant.id, event.id})

    remaining = [event for event in events if event.id not in canceled_ids]
    return canceled_ids, remaining


def claim_pickup_role_events(batch_size=DEFAULT_BATCH_SIZE, *, today=None, max_attempts=MAX_ATTEMPTS):
    from django.db import connection, transaction

    from orders.models import DiscordRoleEvent

    now = timezone.now()
    stale_cutoff = now - timedelta(seconds=PROCESSING_TIMEOUT_SECONDS)
    DiscordRoleEvent.objects.filter(
        status=DiscordRoleEvent.STATUS_PROCESSING,
        updated_at__lt=stale_cutoff,
        attempt_count__lt=max_attempts,
    ).update(
        status=DiscordRoleEvent.STATUS_FAILED,
        last_error='Processing claim expired before completion; retrying.',
        updated_at=now,
    )

    current_day = today or pacific_today()
    grant_window_end = current_day + timedelta(days=ROLLING_WINDOW_DAYS - 1)
    claim_filter = Q(event_type=DiscordRoleEvent.EVENT_REVOKE) | Q(pickup_date__lte=grant_window_end)

    with transaction.atomic():
        queryset = DiscordRoleEvent.objects.filter(
            claim_filter,
            status__in=[DiscordRoleEvent.STATUS_PENDING, DiscordRoleEvent.STATUS_FAILED],
            attempt_count__lt=max_attempts,
        ).order_by('created_at', 'id')
        if connection.features.has_select_for_update:
            if connection.features.has_select_for_update_skip_locked:
                queryset = queryset.select_for_update(skip_locked=True)
            else:
                queryset = queryset.select_for_update()
        event_ids = list(queryset.values_list('id', flat=True)[:batch_size])
        if not event_ids:
            return []
        DiscordRoleEvent.objects.filter(id__in=event_ids).update(
            status=DiscordRoleEvent.STATUS_PROCESSING,
            last_error='',
            updated_at=now,
        )
        return list(DiscordRoleEvent.objects.filter(id__in=event_ids).order_by('created_at', 'id'))


def mark_pickup_role_events(event_ids, status, *, last_error=''):
    from orders.models import DiscordRoleEvent

    if not event_ids:
        return 0
    now = timezone.now()
    updates = {
        'status': status,
        'last_error': last_error,
        'updated_at': now,
    }
    if status in {
        DiscordRoleEvent.STATUS_PROCESSED,
        DiscordRoleEvent.STATUS_PROCESSED_IGNORED,
        DiscordRoleEvent.STATUS_PROCESSED_WITH_WARNING,
        DiscordRoleEvent.STATUS_DEAD_LETTER,
    }:
        updates['processed_at'] = now
    return DiscordRoleEvent.objects.filter(id__in=event_ids).update(**updates)


def mark_pickup_role_event_retry(event_id, error, *, max_attempts=MAX_ATTEMPTS):
    from orders.models import DiscordRoleEvent

    event = DiscordRoleEvent.objects.filter(pk=event_id).first()
    if not event:
        return None
    event.attempt_count += 1
    event.last_error = str(error)
    if event.attempt_count >= max_attempts:
        event.status = DiscordRoleEvent.STATUS_DEAD_LETTER
        event.processed_at = timezone.now()
    else:
        event.status = DiscordRoleEvent.STATUS_FAILED
    event.save(update_fields=['attempt_count', 'last_error', 'status', 'processed_at', 'updated_at'])
    return event.status


def active_pickup_assignments(today=None):
    from orders.discord_pickup_roles import active_pickup_role_assignments

    return active_pickup_role_assignments(today=today)


def active_pickup_dates_for_member(discord_id, today=None):
    from orders.discord_pickup_roles import active_pickup_dates_for_discord_id

    return active_pickup_dates_for_discord_id(discord_id, today=today)


def claim_lifecycle_run(run_date, *, force=False):
    from django.db import IntegrityError, transaction

    from orders.models import DiscordPickupLifecycleRun

    if force:
        run, _ = DiscordPickupLifecycleRun.objects.get_or_create(run_date=run_date)
        run.status = DiscordPickupLifecycleRun.STATUS_PROCESSING
        run.last_error = ''
        run.finished_at = None
        run.save(update_fields=['status', 'last_error', 'finished_at', 'updated_at'])
        return True
    try:
        with transaction.atomic():
            DiscordPickupLifecycleRun.objects.create(run_date=run_date)
        return True
    except IntegrityError:
        return False


def finish_lifecycle_run(run_date, status, *, last_error=''):
    from orders.models import DiscordPickupLifecycleRun

    now = timezone.now()
    return DiscordPickupLifecycleRun.objects.filter(run_date=run_date).update(
        status=status,
        last_error=last_error,
        finished_at=now,
        updated_at=now,
    )


async def _maybe_await(value):
    if hasattr(value, '__await__'):
        return await value
    return value


def _coerce_discord_id(value):
    raw = str(value or '').strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return raw


async def _get_member(guild, discord_id):
    member_id = _coerce_discord_id(discord_id)
    if member_id is None:
        return None

    get_member = getattr(guild, 'get_member', None)
    if get_member:
        member = get_member(member_id)
        if member is None and not isinstance(member_id, str):
            member = get_member(str(member_id))
        if member:
            return member

    fetch_member = getattr(guild, 'fetch_member', None)
    if fetch_member:
        try:
            return await fetch_member(member_id)
        except Exception as exc:
            if _is_discord_not_found(exc):
                return None
            raise
    return None


def _member_pickup_roles(member):
    return [role for role in getattr(member, 'roles', []) if str(getattr(role, 'name', '')).startswith(PICKUP_ROLE_PREFIX)]


async def _role_by_name(guild, role_name):
    return _find_by_name(await _fetch_live_roles(guild), role_name)


async def _sleep_between_mutations(seconds):
    if seconds:
        await asyncio.sleep(seconds)


class PickupRoleOutboxProcessor:
    def __init__(
        self,
        *,
        category_id=None,
        alert_channel_id=None,
        batch_size=DEFAULT_BATCH_SIZE,
        max_attempts=MAX_ATTEMPTS,
        mutation_sleep_seconds=MUTATION_SLEEP_SECONDS,
        log=None,
    ):
        self.category_id = category_id or _django_setting('DISCORD_PICKUP_CATEGORY_ID', PICKUP_CATEGORY_ID)
        self.alert_channel_id = alert_channel_id if alert_channel_id is not None else _django_setting('DISCORD_PICKUP_ALERT_CHANNEL_ID', '')
        self.batch_size = batch_size
        self.max_attempts = max_attempts
        self.mutation_sleep_seconds = mutation_sleep_seconds
        self.log = log or logger

    async def run_once(self, guild, *, today=None):
        result = PickupRoleProcessResult()
        try:
            events = await sync_to_async(claim_pickup_role_events, thread_sensitive=True)(
                self.batch_size,
                today=today,
                max_attempts=self.max_attempts,
            )
        except Exception as exc:
            result.failed = 1
            result.errors.append(str(exc))
            self.log.exception('Failed to claim pickup role events from Django')
            return result

        result.claimed = len(events)
        if not events:
            return result

        canceled_ids, remaining = collapse_canceling_events(events)
        if canceled_ids:
            await sync_to_async(mark_pickup_role_events, thread_sensitive=True)(
                list(canceled_ids),
                'PROCESSED_IGNORED',
                last_error='Same-batch grant/revoke collapsed before Discord mutation.',
            )
            result.ignored += len(canceled_ids)

        for event in remaining:
            await self._process_event(guild, event, result, today=today)
        return result

    async def _process_event(self, guild, event, result, *, today=None):
        try:
            status, message = await self._apply_event(guild, event, today=today)
            await sync_to_async(mark_pickup_role_events, thread_sensitive=True)([event.id], status, last_error=message)
            if status == 'PROCESSED':
                result.processed += 1
            elif status == 'PROCESSED_WITH_WARNING':
                result.warnings += 1
            elif status == 'DEAD_LETTER':
                result.dead_lettered += 1
            else:
                result.ignored += 1
        except Exception as exc:
            await self._handle_event_exception(guild, event, result, exc)

    async def _apply_event(self, guild, event, *, today=None):
        role_name = pickup_role_name(event.pickup_date)
        role = await _role_by_name(guild, role_name)
        if role is None:
            await ensure_rolling_window(guild, category_id=self.category_id, today=today or pacific_today(), log=self.log)
            role = await _role_by_name(guild, role_name)

        if role is None:
            if event.event_type == 'REVOKE':
                return 'PROCESSED_IGNORED', 'Pickup role missing during revoke; no Discord mutation needed.'
            return 'PROCESSED_WITH_WARNING', 'Pickup role missing after rolling-window repair.'

        member = await _get_member(guild, event.discord_id)
        if member is None:
            return 'PROCESSED_IGNORED', 'Discord member not found in guild.'

        member_roles = list(getattr(member, 'roles', []))
        if event.event_type == 'GRANT':
            if role in member_roles:
                return 'PROCESSED_IGNORED', 'Discord member already has pickup role.'
            await member.add_roles(role, reason='SCTCG pickup role grant')
            await _sleep_between_mutations(self.mutation_sleep_seconds)
            return 'PROCESSED', ''

        if event.event_type == 'REVOKE':
            if role not in member_roles:
                return 'PROCESSED_IGNORED', 'Discord member did not have pickup role.'
            await member.remove_roles(role, reason='SCTCG pickup role revoke')
            await _sleep_between_mutations(self.mutation_sleep_seconds)
            return 'PROCESSED', ''

        return 'DEAD_LETTER', f'Unknown DiscordRoleEvent event_type {event.event_type!r}.'

    async def _handle_event_exception(self, guild, event, result, exc):
        message = str(exc)
        if _is_discord_not_found(exc):
            await sync_to_async(mark_pickup_role_events, thread_sensitive=True)([event.id], 'PROCESSED_IGNORED', last_error=message)
            result.ignored += 1
            return
        if _is_discord_role_cap(exc):
            await sync_to_async(mark_pickup_role_events, thread_sensitive=True)([event.id], 'PROCESSED_WITH_WARNING', last_error=message)
            result.warnings += 1
            await self.emit_operational_alert(guild, f'Pickup role automation hit Discord role cap while processing event {event.id}.')
            return
        if _is_discord_forbidden(exc):
            await sync_to_async(mark_pickup_role_events, thread_sensitive=True)([event.id], 'DEAD_LETTER', last_error=message)
            result.dead_lettered += 1
            await self.emit_operational_alert(guild, f'Pickup role automation lacks permission for event {event.id}.')
            return

        status = await sync_to_async(mark_pickup_role_event_retry, thread_sensitive=True)(
            event.id,
            message,
            max_attempts=self.max_attempts,
        )
        if status == 'DEAD_LETTER':
            result.dead_lettered += 1
            await self.emit_operational_alert(guild, f'Pickup role event {event.id} reached dead-letter status: {message}')
        else:
            result.failed += 1
        result.errors.append(message)

    async def emit_operational_alert(self, guild, message):
        clean_message = str(message).replace('@', '@ ')
        channel_id = str(self.alert_channel_id or '').strip()
        if not channel_id:
            self.log.warning(clean_message)
            return False

        lookup_id = _coerce_discord_id(channel_id)
        channel = None
        get_channel = getattr(guild, 'get_channel', None)
        if get_channel:
            channel = get_channel(lookup_id)
        if channel is None:
            fetch_channel = getattr(guild, 'fetch_channel', None)
            if fetch_channel:
                try:
                    channel = await fetch_channel(lookup_id)
                except Exception:
                    self.log.exception('Failed to fetch Discord pickup alert channel %s', channel_id)
                    return False
        if channel is None or not hasattr(channel, 'send'):
            self.log.warning(clean_message)
            return False

        kwargs = {}
        try:
            import discord
            kwargs['allowed_mentions'] = discord.AllowedMentions.none()
        except ImportError:
            pass
        try:
            await channel.send(clean_message, **kwargs)
            return True
        except Exception:
            self.log.exception('Failed to send Discord pickup operational alert')
            return False


class PickupLifecycleRunner:
    def __init__(self, *, category_id=None, alert_processor=None, log=None):
        self.category_id = category_id or _django_setting('DISCORD_PICKUP_CATEGORY_ID', PICKUP_CATEGORY_ID)
        self.alert_processor = alert_processor or PickupRoleOutboxProcessor(category_id=self.category_id)
        self.log = log or logger

    async def run_once(self, guild, *, today=None, force=False):
        run_date = today or pacific_today()
        claimed = await sync_to_async(claim_lifecycle_run, thread_sensitive=True)(run_date, force=force)
        if not claimed:
            return {'status': 'skipped', 'run_date': run_date, 'reason': 'daily lock already exists'}

        try:
            await ensure_rolling_window(guild, category_id=self.category_id, today=run_date, log=self.log)
            cleanup = await cleanup_expired_pickup_infrastructure(
                guild,
                category_id=self.category_id,
                today=run_date,
                log=self.log,
            )
            if cleanup['errors']:
                error_text = '; '.join(cleanup['errors'])
                await sync_to_async(finish_lifecycle_run, thread_sensitive=True)(run_date, 'FAILED', last_error=error_text)
                await self.alert_processor.emit_operational_alert(guild, f'Pickup cleanup completed with errors: {error_text}')
                return {'status': 'failed', 'run_date': run_date, **cleanup}

            await sync_to_async(finish_lifecycle_run, thread_sensitive=True)(run_date, 'COMPLETED')
            return {'status': 'completed', 'run_date': run_date, **cleanup}
        except Exception as exc:
            error_text = str(exc)
            await sync_to_async(finish_lifecycle_run, thread_sensitive=True)(run_date, 'FAILED', last_error=error_text)
            await self.alert_processor.emit_operational_alert(guild, f'Pickup lifecycle failed: {error_text}')
            self.log.exception('Pickup lifecycle failed')
            return {'status': 'failed', 'run_date': run_date, 'errors': [error_text], 'channels_deleted': 0, 'roles_deleted': 0}

    async def tick(self, guild, *, now=None):
        current = now or timezone.now()
        current_day = pacific_today(current)
        local_time = current.astimezone(PACIFIC_TZ).time()
        if local_time.hour < 21:
            return {'status': 'not_due', 'run_date': current_day}
        return await self.run_once(guild, today=current_day)


async def boot_sync_pickup_roles(
    guild,
    *,
    category_id=None,
    today=None,
    force=False,
    mutation_sleep_seconds=MUTATION_SLEEP_SECONDS,
    log=None,
):
    log = log or logger
    guild_key = getattr(guild, 'id', id(guild))
    if not force and guild_key in _BOOT_SYNC_COMPLETED_GUILDS:
        return {'status': 'skipped', 'reason': 'already_synced'}
    if guild_key in _BOOT_SYNC_RUNNING_GUILDS:
        return {'status': 'skipped', 'reason': 'already_running'}

    members = list(getattr(guild, 'members', []))
    if getattr(guild, 'chunked', False) is not True or len(members) <= 10:
        return {'status': 'retry_later', 'retry_after_seconds': BOOT_RETRY_SECONDS, 'member_count': len(members)}

    _BOOT_SYNC_RUNNING_GUILDS.add(guild_key)
    try:
        category_id = category_id or _django_setting('DISCORD_PICKUP_CATEGORY_ID', PICKUP_CATEGORY_ID)
        current_day = today or pacific_today()
        active_dates = set(rolling_pickup_dates(today=current_day))
        await ensure_rolling_window(guild, category_id=category_id, today=current_day, log=log)
        assignments = await sync_to_async(active_pickup_assignments, thread_sensitive=True)(today=current_day)
        expected_by_discord_id = {}
        for pickup_date, discord_ids in assignments.items():
            if pickup_date not in active_dates:
                continue
            role_name = pickup_role_name(pickup_date)
            for discord_id in discord_ids:
                expected_by_discord_id.setdefault(str(discord_id), set()).add(role_name)

        role_by_name = {getattr(role, 'name', ''): role for role in await _fetch_live_roles(guild)}
        result = {'status': 'completed', 'added': 0, 'removed': 0, 'errors': []}
        for member in members:
            member_id = str(getattr(member, 'id', ''))
            expected_names = expected_by_discord_id.get(member_id, set())
            current_pickup_roles = _member_pickup_roles(member)
            current_names = {getattr(role, 'name', '') for role in current_pickup_roles}

            for role_name in sorted(expected_names - current_names):
                role = role_by_name.get(role_name)
                if role is None:
                    continue
                try:
                    await member.add_roles(role, reason='SCTCG pickup boot sync grant')
                    result['added'] += 1
                    await _sleep_between_mutations(mutation_sleep_seconds)
                except Exception as exc:
                    result['errors'].append(f"grant:{member_id}:{role_name}:{exc}")
                    log.exception('Failed to grant pickup role during boot sync')

            for role in current_pickup_roles:
                role_name = getattr(role, 'name', '')
                if role_name in expected_names:
                    continue
                try:
                    await member.remove_roles(role, reason='SCTCG pickup boot sync revoke')
                    result['removed'] += 1
                    await _sleep_between_mutations(mutation_sleep_seconds)
                except Exception as exc:
                    result['errors'].append(f"revoke:{member_id}:{role_name}:{exc}")
                    log.exception('Failed to revoke pickup role during boot sync')

        _BOOT_SYNC_COMPLETED_GUILDS.add(guild_key)
        return result
    except Exception as exc:
        log.exception('Pickup boot sync failed')
        return {'status': 'failed', 'reason': str(exc), 'added': 0, 'removed': 0, 'errors': [str(exc)]}
    finally:
        _BOOT_SYNC_RUNNING_GUILDS.discard(guild_key)


async def sync_member_pickup_roles(
    member,
    *,
    category_id=None,
    today=None,
    mutation_sleep_seconds=MUTATION_SLEEP_SECONDS,
    log=None,
):
    log = log or logger
    guild = getattr(member, 'guild', None)
    if guild is None:
        return {'status': 'skipped', 'reason': 'member has no guild'}
    try:
        current_day = today or pacific_today()
        active_dates = set(rolling_pickup_dates(today=current_day))
        pickup_dates = await sync_to_async(active_pickup_dates_for_member, thread_sensitive=True)(
            str(getattr(member, 'id', '')),
            today=current_day,
        )
        pickup_dates = [pickup_date for pickup_date in pickup_dates if pickup_date in active_dates]
        if not pickup_dates:
            return {'status': 'completed', 'added': 0}

        category_id = category_id or _django_setting('DISCORD_PICKUP_CATEGORY_ID', PICKUP_CATEGORY_ID)
        await ensure_rolling_window(guild, category_id=category_id, today=current_day, log=log)
        role_by_name = {getattr(role, 'name', ''): role for role in await _fetch_live_roles(guild)}
        current_roles = set(getattr(member, 'roles', []))
        added = 0
        for pickup_date in pickup_dates:
            role = role_by_name.get(pickup_role_name(pickup_date))
            if role is None or role in current_roles:
                continue
            try:
                await member.add_roles(role, reason='SCTCG pickup member rejoin sync')
                current_roles.add(role)
                added += 1
                await _sleep_between_mutations(mutation_sleep_seconds)
            except Exception:
                log.exception('Failed to grant pickup role during member join sync')
        return {'status': 'completed', 'added': added}
    except Exception as exc:
        log.exception('Pickup member join sync failed')
        return {'status': 'failed', 'reason': str(exc), 'added': 0}


def create_pickup_role_event_loop(guild_provider, *, processor=None, seconds=10):
    from discord.ext import tasks

    processor = processor or PickupRoleOutboxProcessor()

    @tasks.loop(seconds=seconds)
    async def pickup_role_event_loop():
        try:
            guild = await _maybe_await(guild_provider())
            if guild is not None:
                await processor.run_once(guild)
        except Exception:
            logger.exception('Pickup role event loop tick failed')

    return pickup_role_event_loop


def create_pickup_lifecycle_loop(guild_provider, *, runner=None, minutes=1):
    from discord.ext import tasks

    runner = runner or PickupLifecycleRunner()

    @tasks.loop(minutes=minutes)
    async def pickup_lifecycle_loop():
        try:
            guild = await _maybe_await(guild_provider())
            if guild is not None:
                await runner.tick(guild)
        except Exception:
            logger.exception('Pickup lifecycle loop tick failed')

    return pickup_lifecycle_loop