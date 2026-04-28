from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from .models import DiscordPickupLifecycleRun, DiscordRoleEvent, Order

PACIFIC_TZ = ZoneInfo('America/Los_Angeles')
ROLLING_WINDOW_DAYS = 8
MAX_OUTBOX_ATTEMPTS = 3
PROCESSING_TIMEOUT_SECONDS = 300


def pacific_today(now=None):
    current = now or timezone.now()
    if timezone.is_naive(current):
        current = timezone.make_aware(current, timezone=PACIFIC_TZ)
    return current.astimezone(PACIFIC_TZ).date()


def normalized_discord_id(value):
    return str(value or '').strip()


def profile_discord_id_for_user(user):
    if not user:
        return ''
    try:
        profile = user.profile
    except Exception:
        return ''
    return normalized_discord_id(getattr(profile, 'discord_id', ''))


def order_pickup_role_discord_id(order):
    return profile_discord_id_for_user(order.user)


def is_active_pickup_order(order):
    return (
        order.delivery_method == 'scheduled'
        and bool(order.pickup_date)
        and order.status in Order.ACTIVE_ORDER_STATUSES
        and bool(order_pickup_role_discord_id(order))
    )


def has_other_active_pickup_order(user_id, pickup_date, *, exclude_order_id=None):
    if not user_id or not pickup_date:
        return False
    queryset = Order.objects.filter(
        user_id=user_id,
        delivery_method='scheduled',
        pickup_date=pickup_date,
        status__in=Order.ACTIVE_ORDER_STATUSES,
    )
    if exclude_order_id:
        queryset = queryset.exclude(pk=exclude_order_id)
    return queryset.exists()


def enqueue_pickup_role_event(event_type, discord_id, pickup_date, *, order=None, metadata=None):
    discord_id = normalized_discord_id(discord_id)
    if not discord_id or not pickup_date:
        return None
    existing = DiscordRoleEvent.objects.filter(
        event_type=event_type,
        discord_id=discord_id,
        pickup_date=pickup_date,
        status__in=[
            DiscordRoleEvent.STATUS_PENDING,
            DiscordRoleEvent.STATUS_PROCESSING,
            DiscordRoleEvent.STATUS_FAILED,
        ],
    ).first()
    if existing:
        return existing
    return DiscordRoleEvent.objects.create(
        event_type=event_type,
        discord_id=discord_id,
        pickup_date=pickup_date,
        order=order,
        metadata=metadata or {},
    )


def enqueue_grant_for_order(order, *, reason):
    if not is_active_pickup_order(order):
        return None
    return enqueue_pickup_role_event(
        DiscordRoleEvent.EVENT_GRANT,
        order_pickup_role_discord_id(order),
        order.pickup_date,
        order=order,
        metadata={'reason': reason},
    )


def enqueue_revoke_for_previous_pickup(previous_state, order, *, reason):
    pickup_date = previous_state.get('pickup_date')
    user_id = previous_state.get('user_id')
    discord_id = normalized_discord_id(previous_state.get('discord_id')) or order_pickup_role_discord_id(order)
    if not pickup_date or not user_id or not discord_id:
        return None
    if has_other_active_pickup_order(user_id, pickup_date, exclude_order_id=order.pk):
        return None
    return enqueue_pickup_role_event(
        DiscordRoleEvent.EVENT_REVOKE,
        discord_id,
        pickup_date,
        order=order,
        metadata={'reason': reason},
    )


def previous_state_is_active_pickup(previous_state):
    return (
        previous_state.get('delivery_method') == 'scheduled'
        and bool(previous_state.get('pickup_date'))
        and previous_state.get('status') in Order.ACTIVE_ORDER_STATUSES
    )


def handle_order_pickup_role_events(order_id, *, created, previous_state=None):
    order = Order.objects.select_related('user', 'user__profile').filter(pk=order_id).first()
    if not order:
        return

    previous_state = previous_state or {}
    current_active_pickup = is_active_pickup_order(order)
    previous_active_pickup = previous_state_is_active_pickup(previous_state)
    pickup_date_changed = previous_state.get('pickup_date') != order.pickup_date

    if previous_active_pickup and (pickup_date_changed or not current_active_pickup):
        enqueue_revoke_for_previous_pickup(previous_state, order, reason='order_changed')

    if current_active_pickup and (created or not previous_active_pickup or pickup_date_changed):
        enqueue_grant_for_order(order, reason='order_active_pickup')


def active_pickup_orders_for_user(user_id):
    if not user_id:
        return Order.objects.none()
    return Order.objects.filter(
        user_id=user_id,
        delivery_method='scheduled',
        pickup_date__gte=pacific_today(),
        pickup_date__isnull=False,
        status__in=Order.ACTIVE_ORDER_STATUSES,
    )


def active_pickup_role_assignments(today=None):
    cutoff = today or pacific_today()
    rows = Order.objects.filter(
        delivery_method='scheduled',
        pickup_date__gte=cutoff,
        pickup_date__isnull=False,
        status__in=Order.ACTIVE_ORDER_STATUSES,
        user__profile__discord_id__isnull=False,
    ).exclude(
        user__profile__discord_id='',
    ).values_list('pickup_date', 'user__profile__discord_id').distinct()

    assignments = {}
    for pickup_date, discord_id in rows:
        normalized = normalized_discord_id(discord_id)
        if normalized:
            assignments.setdefault(pickup_date, set()).add(normalized)
    return assignments


def active_pickup_dates_for_discord_id(discord_id, today=None):
    normalized = normalized_discord_id(discord_id)
    if not normalized:
        return []
    cutoff = today or pacific_today()
    return list(Order.objects.filter(
        delivery_method='scheduled',
        pickup_date__gte=cutoff,
        pickup_date__isnull=False,
        status__in=Order.ACTIVE_ORDER_STATUSES,
        user__profile__discord_id=normalized,
    ).order_by('pickup_date').values_list('pickup_date', flat=True).distinct())


def serialize_pickup_role_event(event):
    return {
        'id': event.id,
        'event_type': event.event_type,
        'discord_id': event.discord_id,
        'pickup_date': event.pickup_date.isoformat(),
        'attempt_count': event.attempt_count,
        'metadata': event.metadata or {},
    }


def claim_pickup_role_events_for_bot(batch_size=25, *, today=None, max_attempts=MAX_OUTBOX_ATTEMPTS):
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


def complete_pickup_role_event_for_bot(event_id, result_status, *, last_error='', max_attempts=MAX_OUTBOX_ATTEMPTS):
    terminal_statuses = {
        DiscordRoleEvent.STATUS_PROCESSED,
        DiscordRoleEvent.STATUS_PROCESSED_IGNORED,
        DiscordRoleEvent.STATUS_PROCESSED_WITH_WARNING,
        DiscordRoleEvent.STATUS_DEAD_LETTER,
    }
    allowed_statuses = terminal_statuses | {DiscordRoleEvent.STATUS_FAILED}
    if result_status not in allowed_statuses:
        raise ValueError('Unsupported pickup role event status.')

    event = DiscordRoleEvent.objects.filter(pk=event_id).first()
    if not event:
        return None

    event.last_error = str(last_error or '')[:4000]
    if result_status == DiscordRoleEvent.STATUS_FAILED:
        event.attempt_count += 1
        if event.attempt_count >= max_attempts:
            event.status = DiscordRoleEvent.STATUS_DEAD_LETTER
            event.processed_at = timezone.now()
        else:
            event.status = DiscordRoleEvent.STATUS_FAILED
    else:
        event.status = result_status
        if result_status in terminal_statuses:
            event.processed_at = timezone.now()
    event.save(update_fields=['attempt_count', 'last_error', 'status', 'processed_at', 'updated_at'])
    return event


def serialize_pickup_role_assignments(assignments):
    return [
        {'pickup_date': pickup_date.isoformat(), 'discord_ids': sorted(discord_ids)}
        for pickup_date, discord_ids in sorted(assignments.items())
    ]


def claim_pickup_lifecycle_run_for_bot(run_date, *, force=False):
    from django.db import IntegrityError

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


def finish_pickup_lifecycle_run_for_bot(run_date, result_status, *, last_error=''):
    allowed_statuses = {
        DiscordPickupLifecycleRun.STATUS_COMPLETED,
        DiscordPickupLifecycleRun.STATUS_FAILED,
    }
    if result_status not in allowed_statuses:
        raise ValueError('Unsupported pickup lifecycle status.')
    return DiscordPickupLifecycleRun.objects.filter(run_date=run_date).update(
        status=result_status,
        last_error=str(last_error or '')[:4000],
        finished_at=timezone.now(),
        updated_at=timezone.now(),
    )


def enqueue_grants_for_profile(profile_id):
    from users.models import UserProfile

    profile = UserProfile.objects.select_related('user').filter(pk=profile_id).first()
    if not profile:
        return 0
    discord_id = normalized_discord_id(profile.discord_id)
    if not discord_id:
        return 0

    created = 0
    for order in active_pickup_orders_for_user(profile.user_id):
        event = enqueue_pickup_role_event(
            DiscordRoleEvent.EVENT_GRANT,
            discord_id,
            order.pickup_date,
            order=order,
            metadata={'reason': 'discord_late_link'},
        )
        created += 1 if event else 0
    return created


def pickup_date_from_iso(value):
    return datetime.strptime(value, '%Y-%m-%d').date()