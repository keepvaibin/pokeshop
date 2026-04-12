import logging
from datetime import timedelta
from decimal import Decimal
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from inventory.models import PokeshopSettings
from users.models import UserProfile

from .models import Order, SupportTicket


logger = logging.getLogger(__name__)

PROCESSING_BLUE = '#0c55a5'
ACTION_GOLD = '#ffcb05'
SUCCESS_GREEN = '#1a9338'
ISSUE_RED = '#e3350d'

ASAP_REMINDER_THRESHOLDS = (
    (1, timedelta(minutes=30)),
    (2, timedelta(hours=2)),
    (3, timedelta(hours=6)),
)
EOD_SUMMARY_HOUR = 20
ACTIVE_ORDER_STATUSES = ('pending', 'cash_needed', 'trade_review', 'pending_counteroffer')
ASAP_REMINDER_STATUSES = ('pending', 'cash_needed', 'pending_counteroffer')
TRADE_REVIEW_STATUSES = ('trade_review', 'pending_counteroffer')


def _heartbeat_now():
    return timezone.now()


def _is_valid_discord_webhook_url(url: str) -> bool:
    if not url:
        return False
    parsed = urlparse(url)
    return (
        parsed.scheme == 'https'
        and parsed.hostname in ('discord.com', 'discordapp.com')
        and '/api/webhooks/' in parsed.path
    )


def _hex_color_to_int(value: str) -> int:
    return int(value.lstrip('#'), 16)


def _money(value) -> str:
    amount = Decimal(str(value or 0)).quantize(Decimal('0.01'))
    return f'${amount:.2f}'


def _format_duration(delta) -> str:
    total_minutes = max(0, int(delta.total_seconds() // 60))
    hours, minutes = divmod(total_minutes, 60)
    if hours and minutes:
        return f'{hours}h {minutes}m'
    if hours:
        return f'{hours}h'
    return f'{minutes}m'


def _payment_label(value: str) -> str:
    labels = {
        'venmo': 'Venmo',
        'zelle': 'Zelle',
        'paypal': 'PayPal',
        'trade': 'Trade-In',
        'cash_plus_trade': 'Trade + Balance',
    }
    return labels.get(value, (value or '').replace('_', ' ').title())


def _status_label(value: str) -> str:
    labels = {
        'pending': 'Pending',
        'fulfilled': 'Fulfilled',
        'cancelled': 'Cancelled',
        'cash_needed': 'Balance Due',
        'trade_review': 'Trade Under Review',
        'pending_counteroffer': 'Counteroffer Pending',
    }
    return labels.get(value, (value or '').replace('_', ' ').title())


def _get_trade_offer(order):
    try:
        return order.trade_offer
    except Exception:
        return None


def _order_url(order) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/orders/{order.order_id}"


def _delivery_label(order) -> str:
    if order.delivery_method == 'asap':
        return 'ASAP / Downtown'
    if order.pickup_timeslot:
        return str(order.pickup_timeslot)
    if order.recurring_timeslot and order.pickup_date:
        readable_date = order.pickup_date.strftime('%A, %b %d').replace(' 0', ' ')
        return f'{readable_date} • {order.recurring_timeslot}'
    if order.recurring_timeslot:
        return str(order.recurring_timeslot)
    return 'Scheduled campus pickup'


def _item_thumbnail_url(order) -> str:
    image_path = (order.item.image_path or '').strip()
    if image_path.startswith(('http://', 'https://')):
        return image_path

    images_manager = getattr(order.item, 'images', None)
    if images_manager is None:
        return ''

    first_image = images_manager.all().first()
    if not first_image:
        return ''

    image_url = getattr(first_image.image, 'url', '') or ''
    if image_url.startswith(('http://', 'https://')):
        return image_url
    return ''


def _order_discount(order) -> Decimal:
    return Decimal(str(order.discount_applied or 0)).quantize(Decimal('0.01'))


def _order_subtotal_after_discount(order) -> Decimal:
    item_price = Decimal(str(order.item.price or 0)).quantize(Decimal('0.01'))
    subtotal = (item_price * order.quantity) - _order_discount(order)
    return max(Decimal('0.00'), subtotal.quantize(Decimal('0.01')))


def _order_trade_credit(order) -> Decimal:
    trade_offer = _get_trade_offer(order)
    if not trade_offer:
        return Decimal('0.00')
    return Decimal(str(trade_offer.total_credit or 0)).quantize(Decimal('0.01'))


def _order_cash_due(order) -> Decimal:
    subtotal = _order_subtotal_after_discount(order)
    trade_credit = _order_trade_credit(order)
    return max(Decimal('0.00'), (subtotal - trade_credit).quantize(Decimal('0.01')))


def _build_order_fields(order) -> list[dict[str, object]]:
    fields: list[dict[str, object]] = [
        {'name': 'Item', 'value': order.item.title, 'inline': True},
        {'name': 'Quantity', 'value': str(order.quantity), 'inline': True},
        {'name': 'Status', 'value': _status_label(order.status), 'inline': True},
        {'name': 'Delivery', 'value': _delivery_label(order), 'inline': False},
    ]

    payment_value = _payment_label(order.payment_method)
    if order.backup_payment_method:
        payment_value = f'{payment_value} • backup: {_payment_label(order.backup_payment_method)}'
    fields.append({'name': 'Payment', 'value': payment_value, 'inline': False})

    trade_credit = _order_trade_credit(order)
    if trade_credit > 0:
        fields.append({'name': 'Trade Credit', 'value': _money(trade_credit), 'inline': True})

    cash_due = _order_cash_due(order)
    if order.status == 'cash_needed' or (order.payment_method == 'cash_plus_trade' and cash_due > 0):
        fields.append({'name': 'Balance Due', 'value': _money(cash_due), 'inline': True})

    return fields[:25]


def _build_order_dm_payload(
    order,
    *,
    title: str,
    description: str,
    color: str,
    button_label: str = 'View Order',
    extra_fields: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        'title': title,
        'description': description,
        'color': color,
        'url': _order_url(order),
        'fields': _build_order_fields(order) + (extra_fields or []),
        'button': {'label': button_label, 'url': _order_url(order)},
    }
    thumbnail_url = _item_thumbnail_url(order)
    if thumbnail_url:
        payload['thumbnail_url'] = thumbnail_url
    return payload


def _pending_description(order) -> str:
    if order.delivery_method == 'asap':
        return (
            f'Your order for {order.item.title} is active and ready for downtown pickup coordination. '
            'Open the order page for the latest details.'
        )
    return (
        f'Your order for {order.item.title} is active and moving through the shop queue. '
        'Open the order page for the latest pickup details.'
    )


def _cash_needed_description(order) -> str:
    cash_due = _money(_order_cash_due(order))
    previous_status = getattr(order, '_previous_status', None)
    trade_credit = _order_trade_credit(order)
    if (
        previous_status in TRADE_REVIEW_STATUSES
        and order.buy_if_trade_denied
        and order.payment_method == 'venmo'
        and trade_credit <= 0
    ):
        return (
            'Your trade offer was reviewed and declined. However, since you opted to fall back to cash, '
            f'your order is still active! Please pay the remaining balance of {cash_due} to finalize your checkout.'
        )
    if trade_credit > 0:
        return (
            f'Your order for {order.item.title} is still active. We applied the approved trade credit, '
            f'and the remaining balance is {cash_due}.'
        )
    if order.buy_if_trade_denied:
        return (
            f'Your order for {order.item.title} is still active and now needs a cash payment of {cash_due} '
            'to finish checkout.'
        )
    return f'Your order for {order.item.title} is still active and the current balance due is {cash_due}.'


def build_order_status_dm(order) -> dict[str, object] | None:
    if order.status == 'pending':
        return _build_order_dm_payload(
            order,
            title='Order Update: Processing',
            description=_pending_description(order),
            color=PROCESSING_BLUE,
            button_label='View Order',
        )
    if order.status == 'trade_review':
        return _build_order_dm_payload(
            order,
            title='Order Update: Trade Under Review',
            description=f'Your order for {order.item.title} is processing and your trade-in is under review.',
            color=PROCESSING_BLUE,
            button_label='View Order',
        )
    if order.status == 'pending_counteroffer':
        extra_fields: list[dict[str, object]] = []
        if order.counteroffer_expires_at:
            expires_at = timezone.localtime(order.counteroffer_expires_at).strftime('%b %d, %I:%M %p')
            extra_fields.append({'name': 'Respond By', 'value': expires_at, 'inline': True})
        return _build_order_dm_payload(
            order,
            title='Order Update: Counteroffer Ready',
            description=f'Your order for {order.item.title} has a counteroffer waiting for your review.',
            color=ACTION_GOLD,
            button_label='Review Counteroffer',
            extra_fields=extra_fields,
        )
    if order.status == 'fulfilled':
        return _build_order_dm_payload(
            order,
            title='Order Update: Completed',
            description=f'Your order for {order.item.title} has been completed. Open the order page for the latest pickup details.',
            color=SUCCESS_GREEN,
            button_label='View Order',
        )
    if order.status == 'cash_needed':
        return _build_order_dm_payload(
            order,
            title='Order Update: Balance Due',
            description=_cash_needed_description(order),
            color=PROCESSING_BLUE,
            button_label='Review Balance',
        )
    if order.status == 'cancelled':
        return _build_order_dm_payload(
            order,
            title='Order Update: Cancelled',
            description=f'Your order for {order.item.title} has been cancelled.',
            color=ISSUE_RED,
            button_label='View Order',
        )
    return None


def send_discord_dm(
    user,
    title,
    description,
    color,
    url=None,
    fields=None,
    thumbnail_url='',
    button=None,
) -> bool:
    if user is None:
        return False

    profile = UserProfile.objects.filter(user=user).only('discord_id').first()
    discord_id = profile.discord_id if profile else None
    if not discord_id:
        return False

    api_key = getattr(settings, 'SCTCG_BOT_API_KEY', '').strip()
    dm_url = getattr(settings, 'SCTCG_BOT_DM_URL', '').strip()
    if not api_key or not dm_url:
        logger.warning('Discord DM gateway is not configured; skipping DM for user %s', user.pk)
        return False

    payload = {
        'discord_id': discord_id,
        'title': title,
        'description': description,
        'color': color,
        'url': url or '',
    }
    if fields:
        payload['fields'] = fields
    if thumbnail_url:
        payload['thumbnail_url'] = thumbnail_url
    if button:
        payload['button'] = button

    try:
        response = requests.post(
            dm_url,
            json=payload,
            headers={
                'Content-Type': 'application/json',
                'X-SCTCG-Bot-API-Key': api_key,
            },
            timeout=5,
        )
        response.raise_for_status()
        return True
    except requests.RequestException:
        logger.exception('Failed to send Discord DM for user %s', user.pk)
        return False


def notify_order_status_via_dm(order) -> bool:
    payload = build_order_status_dm(order)
    if not payload:
        return False
    return send_discord_dm(order.user, **payload)


def _due_asap_reminder_level(order, now):
    age = now - order.created_at
    next_level = order.asap_reminder_level
    for level, threshold in ASAP_REMINDER_THRESHOLDS:
        if age >= threshold:
            next_level = level
    return next_level if next_level > order.asap_reminder_level else None


def build_asap_reminder_dm(order, level: int, now=None) -> dict[str, object]:
    now = now or _heartbeat_now()
    age_label = _format_duration(now - order.created_at)
    color = ACTION_GOLD if level >= 3 else PROCESSING_BLUE
    extra_fields: list[dict[str, object]] = [
        {'name': 'Order Age', 'value': age_label, 'inline': True},
    ]

    if order.status == 'pending_counteroffer':
        title = 'ASAP Reminder: Counteroffer Waiting'
        description = (
            f'Your ASAP order for {order.item.title} still has a counteroffer waiting. '
            'Review it now if you want to keep the same-day pickup moving.'
        )
        button_label = 'Review Counteroffer'
    elif order.status == 'cash_needed':
        title = 'ASAP Reminder: Balance Due'
        description = (
            f'Your ASAP order for {order.item.title} is still active, but the remaining balance of '
            f'{_money(_order_cash_due(order))} must be settled before the meetup can be finalized.'
        )
        button_label = 'Review Balance'
    else:
        title = 'ASAP Reminder: Pickup Coordination'
        description = (
            f'Your ASAP order for {order.item.title} is still open for downtown pickup coordination. '
            'Open the order page and message keepvaibin on Discord to keep it moving.'
        )
        button_label = 'Open Order'

    if level >= 3:
        extra_fields.append({'name': 'Same-Day Window', 'value': 'This is the final automated reminder for today.', 'inline': False})

    return _build_order_dm_payload(
        order,
        title=title,
        description=description,
        color=color,
        button_label=button_label,
        extra_fields=extra_fields,
    )


def _reserve_due_asap_reminder_actions(now=None) -> list[dict[str, object]]:
    now = now or _heartbeat_now()
    actions: list[dict[str, object]] = []
    orders = (
        Order.objects.filter(
            delivery_method='asap',
            status__in=ASAP_REMINDER_STATUSES,
            asap_reminder_level__lt=len(ASAP_REMINDER_THRESHOLDS),
        )
        .select_related('item', 'user', 'user__profile', 'pickup_timeslot', 'recurring_timeslot')
        .prefetch_related('item__images')
        .order_by('created_at')
    )

    with transaction.atomic():
        for order in orders:
            due_level = _due_asap_reminder_level(order, now)
            if not due_level:
                continue

            profile = getattr(order.user, 'profile', None)
            discord_id = getattr(profile, 'discord_id', None)
            if not discord_id:
                continue

            order.asap_reminder_level = due_level
            order.save(update_fields=['asap_reminder_level'])
            actions.append({
                'type': 'dm',
                'discord_id': discord_id,
                **build_asap_reminder_dm(order, due_level, now=now),
            })

    return actions


def _build_eod_summary_webhook_payload(now=None) -> dict[str, object]:
    now = now or _heartbeat_now()
    local_now = timezone.localtime(now)
    active_orders = Order.objects.filter(status__in=ACTIVE_ORDER_STATUSES).select_related('user').order_by('created_at')
    open_tickets = SupportTicket.objects.filter(status='open').select_related('user').order_by('-created_at')

    counts = {status: active_orders.filter(status=status).count() for status in ACTIVE_ORDER_STATUSES}
    asap_orders = list(active_orders.filter(delivery_method='asap')[:5])
    latest_tickets = list(open_tickets[:3])

    fields: list[dict[str, object]] = [
        {'name': 'Open Orders', 'value': str(active_orders.count()), 'inline': True},
        {'name': 'ASAP Still Open', 'value': str(active_orders.filter(delivery_method='asap').count()), 'inline': True},
        {'name': 'Open Tickets', 'value': str(open_tickets.count()), 'inline': True},
        {'name': 'Pending', 'value': str(counts['pending']), 'inline': True},
        {'name': 'Balance Due', 'value': str(counts['cash_needed']), 'inline': True},
        {'name': 'Counteroffers', 'value': str(counts['pending_counteroffer']), 'inline': True},
        {'name': 'Trade Reviews', 'value': str(counts['trade_review']), 'inline': True},
    ]

    if asap_orders:
        oldest_lines = []
        for order in asap_orders:
            age = _format_duration(local_now - timezone.localtime(order.created_at))
            oldest_lines.append(f'• {str(order.order_id)[:8]} • {order.user.email} • {_status_label(order.status)} • {age}')
        fields.append({'name': 'Oldest ASAP Orders', 'value': '\n'.join(oldest_lines), 'inline': False})

    if latest_tickets:
        ticket_lines = []
        for ticket in latest_tickets:
            user_label = ticket.user.email if ticket.user else ticket.discord_user_id
            ticket_lines.append(f'• {ticket.subject} • {user_label}')
        fields.append({'name': 'Latest Open Tickets', 'value': '\n'.join(ticket_lines), 'inline': False})

    embed = {
        'title': f'End of Day Summary • {local_now.strftime("%b %d")}',
        'description': 'Daily Discord closeout snapshot generated by the Django heartbeat pipeline.',
        'color': _hex_color_to_int(PROCESSING_BLUE),
        'fields': fields[:25],
    }

    return {
        'allowed_mentions': {'parse': []},
        'embeds': [embed],
    }


def _reserve_eod_summary_action(now=None) -> dict[str, object] | None:
    now = now or _heartbeat_now()
    local_now = timezone.localtime(now)
    if local_now.hour < EOD_SUMMARY_HOUR:
        return None

    with transaction.atomic():
        settings_obj = PokeshopSettings.objects.select_for_update().filter(pk=1).first()
        if settings_obj is None:
            settings_obj = PokeshopSettings(pk=1)
            settings_obj.save()

        webhook_url = (settings_obj.discord_webhook_url or '').strip()
        if settings_obj.last_discord_eod_summary_on == local_now.date() or not _is_valid_discord_webhook_url(webhook_url):
            return None

        settings_obj.last_discord_eod_summary_on = local_now.date()
        settings_obj.save(update_fields=['last_discord_eod_summary_on'])

    return {
        'type': 'webhook',
        'webhook_url': webhook_url,
        'payload': _build_eod_summary_webhook_payload(now=now),
    }


def collect_discord_heartbeat_actions(now=None) -> list[dict[str, object]]:
    now = now or _heartbeat_now()
    actions = _reserve_due_asap_reminder_actions(now=now)
    eod_action = _reserve_eod_summary_action(now=now)
    if eod_action:
        actions.append(eod_action)
    return actions