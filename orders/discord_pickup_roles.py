from datetime import datetime, time as dt_time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from .scheduling import (
    as_customer_pickup_time,
    customer_pickup_cutoff,
    next_customer_pickup_date_for_timeslot,
)
from .models import DiscordPickupLifecycleRun, DiscordRoleEvent, Order

PACIFIC_TZ = ZoneInfo('America/Los_Angeles')
ROLLING_WINDOW_DAYS = 8
MAX_OUTBOX_ATTEMPTS = 3
PROCESSING_TIMEOUT_SECONDS = 300
PICKUP_CHANNEL_EXPIRY_HOUR = 21
AUTO_CANCEL_EXPIRED_PICKUP_REASON = 'Automatically cancelled after the pickup-day 9 PM Pacific rollover.'


def pacific_today(now=None):
    current = now or timezone.now()
    if timezone.is_naive(current):
        current = timezone.make_aware(current, timezone=PACIFIC_TZ)
    return current.astimezone(PACIFIC_TZ).date()


def pickup_channel_expires_at(pickup_date):
    return datetime.combine(pickup_date, dt_time(hour=PICKUP_CHANNEL_EXPIRY_HOUR), tzinfo=PACIFIC_TZ)


def pickup_channel_is_active(pickup_date, *, now=None):
    current = as_customer_pickup_time(now or timezone.now())
    return current < pickup_channel_expires_at(pickup_date)


def _append_timeline(order, event, detail=''):
    if not isinstance(order.resolution_summary, list):
        order.resolution_summary = []
    order.resolution_summary.append({
        'timestamp': timezone.now().isoformat(),
        'event': event,
        'detail': detail,
    })


def _money_value(value):
    return Decimal(str(value or 0)).quantize(Decimal('0.01'))


def _restore_order_stock(order):
    from inventory.models import Item

    for order_item in order.order_items.select_related('item'):
        item = Item.objects.select_for_update().get(pk=order_item.item_id)
        item.stock += order_item.quantity
        item.save(update_fields=['stock'])


def _release_order_pickup_resources(order):
    if order.pickup_slot_id and getattr(order, 'pickup_slot', None):
        order.pickup_slot.is_claimed = False
        order.pickup_slot.save(update_fields=['is_claimed'])
    if order.pickup_timeslot_id and getattr(order, 'pickup_timeslot', None):
        order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
        order.pickup_timeslot.save(update_fields=['current_bookings'])


def _refund_store_credit_if_needed(order, *, note):
    amount = _money_value(getattr(order, 'store_credit_applied', 0))
    if amount <= Decimal('0') or not order.user_id:
        return

    from trade_ins.models import CreditLedger
    from users.models import UserProfile

    profile, _ = UserProfile.objects.select_for_update().get_or_create(user=order.user)
    profile.trade_credit_balance = _money_value(profile.trade_credit_balance) + amount
    profile.save(update_fields=['trade_credit_balance'])
    CreditLedger.objects.create(
        user=order.user,
        amount=amount,
        transaction_type=CreditLedger.TYPE_ORDER_REFUND,
        reference_id=f'order:{order.order_id}',
        note=note,
        created_by=None,
    )


def cancel_expired_pickup_orders(*, now=None):
    current = as_customer_pickup_time(now or timezone.now())
    candidates = Order.objects.filter(
        delivery_method='scheduled',
        pickup_date__isnull=False,
        pickup_date__lte=current.date(),
        status__in=Order.ACTIVE_ORDER_STATUSES,
    ).select_related(
        'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
    ).prefetch_related('order_items__item').order_by('pickup_date', 'id')

    cancelled = []
    for candidate in candidates:
        if current < pickup_channel_expires_at(candidate.pickup_date):
            continue
        with transaction.atomic():
            order = Order.objects.select_for_update().select_related(
                'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
            ).prefetch_related('order_items__item').get(pk=candidate.pk)
            if order.status not in Order.ACTIVE_ORDER_STATUSES or order.delivery_method != 'scheduled' or not order.pickup_date:
                continue
            if current < pickup_channel_expires_at(order.pickup_date):
                continue

            _restore_order_stock(order)
            _release_order_pickup_resources(order)
            order.status = 'cancelled'
            order.cancelled_at = timezone.now()
            order.cancelled_by = None
            order.cancellation_reason = AUTO_CANCEL_EXPIRED_PICKUP_REASON
            _refund_store_credit_if_needed(order, note='Store credit returned after pickup-day rollover cancellation.')
            _append_timeline(order, 'pickup_rollover_auto_cancelled', AUTO_CANCEL_EXPIRED_PICKUP_REASON)
            order.save()
            if order.pickup_timeslot_id and getattr(order, 'pickup_timeslot', None):
                order.pickup_timeslot.refresh_current_bookings(save=True)
            cancelled.append(order)
    return cancelled


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
        _wake_pickup_role_worker()
        return existing
    event = DiscordRoleEvent.objects.create(
        event_type=event_type,
        discord_id=discord_id,
        pickup_date=pickup_date,
        order=order,
        metadata=metadata or {},
    )
    _wake_pickup_role_worker()
    return event


def _wake_pickup_role_worker():
    try:
        from .services import notify_pickup_role_outbox_wakeup
        notify_pickup_role_outbox_wakeup()
    except Exception:
        pass


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


def pickup_grant_event_exists(discord_id, pickup_date):
    discord_id = normalized_discord_id(discord_id)
    if not discord_id or not pickup_date:
        return False
    return DiscordRoleEvent.objects.filter(
        event_type=DiscordRoleEvent.EVENT_GRANT,
        discord_id=discord_id,
        pickup_date=pickup_date,
    ).exists()


def enqueue_missing_active_pickup_role_grants(*, dry_run=False, reason='pickup_role_auto_repair'):
    active_orders = Order.objects.select_related('user', 'user__profile').filter(
        delivery_method='scheduled',
        pickup_date__isnull=False,
        status__in=Order.ACTIVE_ORDER_STATUSES,
    ).order_by('pickup_date', 'id')

    result = {
        'enqueued': 0,
        'already_exists': 0,
        'missing_discord_id': 0,
    }
    seen = set()
    for order in active_orders:
        discord_id = order_pickup_role_discord_id(order)
        if not discord_id:
            result['missing_discord_id'] += 1
            continue

        key = (discord_id, order.pickup_date)
        if key in seen:
            continue
        seen.add(key)

        if pickup_grant_event_exists(discord_id, order.pickup_date):
            result['already_exists'] += 1
            continue

        result['enqueued'] += 1
        if not dry_run:
            enqueue_grant_for_order(order, reason=reason)

    return result


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
        pickup_date__in=active_order_pickup_dates(),
        pickup_date__isnull=False,
        status__in=Order.ACTIVE_ORDER_STATUSES,
    )


def active_pickup_role_assignments(today=None):
    valid_dates = active_order_pickup_dates(today=today)
    if not valid_dates:
        return {}
    rows = Order.objects.filter(
        delivery_method='scheduled',
        pickup_date__in=valid_dates,
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
    valid_dates = active_order_pickup_dates(today=today)
    if not valid_dates:
        return []
    return list(Order.objects.filter(
        delivery_method='scheduled',
        pickup_date__in=valid_dates,
        status__in=Order.ACTIVE_ORDER_STATUSES,
        user__profile__discord_id=normalized,
    ).order_by('pickup_date').values_list('pickup_date', flat=True).distinct())


def active_order_pickup_dates(today=None, *, now=None):
    current = as_customer_pickup_time(now or timezone.now())
    start = today or current.date()
    candidate_dates = Order.objects.filter(
        delivery_method='scheduled',
        pickup_date__gte=start,
        pickup_date__isnull=False,
        status__in=Order.ACTIVE_ORDER_STATUSES,
    ).order_by('pickup_date').values_list('pickup_date', flat=True).distinct()
    return [pickup_date for pickup_date in candidate_dates if pickup_channel_is_active(pickup_date, now=current)]


def configured_pickup_dates(today=None, window_days=ROLLING_WINDOW_DAYS, *, now=None):
    from inventory.models import PickupTimeslot, RecurringTimeslot

    current = as_customer_pickup_time(now or timezone.now())
    start = today or current.date()
    window_days = max(1, int(window_days or ROLLING_WINDOW_DAYS))
    window_dates = [start + timedelta(days=offset) for offset in range(window_days)]
    end = window_dates[-1]

    active_timeslots = RecurringTimeslot.objects.filter(
        is_active=True,
    )
    pickup_dates = {
        next_customer_pickup_date_for_timeslot(timeslot, now=current, reference_date=start)
        for timeslot in active_timeslots
        if timeslot.has_customer_usable_window
    }

    pickup_dates.update(active_order_pickup_dates(today=start, now=current))

    one_off_starts = PickupTimeslot.objects.filter(
        is_active=True,
        start__date__gte=start,
        start__date__lte=end,
    ).values_list('start', flat=True)
    for start_at in one_off_starts:
        pickup_date = timezone.localtime(start_at, PACIFIC_TZ).date()
        if current < customer_pickup_cutoff(pickup_date):
            pickup_dates.add(pickup_date)

    return sorted(pickup_dates)


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
    enqueue_missing_active_pickup_role_grants(reason='pickup_role_claim_repair')

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
    valid_pickup_dates = configured_pickup_dates(today=current_day)
    claim_filter = Q(event_type=DiscordRoleEvent.EVENT_REVOKE)
    if valid_pickup_dates:
        claim_filter |= Q(pickup_date__in=valid_pickup_dates)

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


def serialize_configured_pickup_dates(pickup_dates):
    return [pickup_date.isoformat() for pickup_date in pickup_dates]


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