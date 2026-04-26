import logging
import threading
from datetime import timedelta
from decimal import Decimal
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from inventory.models import PokeshopSettings
from users.models import UserProfile

from .models import Order, OrderItem, SupportTicket


logger = logging.getLogger(__name__)

PROCESSING_BLUE = '#0c55a5'
ACTION_GOLD = '#ffcb05'
SUCCESS_GREEN = '#1a9338'
ISSUE_RED = '#e3350d'

ASAP_ACK_DEADLINE = timedelta(hours=24)
ASAP_REMINDER_THRESHOLDS = (
    (1, timedelta(hours=12)),
    (2, timedelta(hours=20)),
    (3, timedelta(hours=23)),
)
EOD_SUMMARY_HOUR = 20
ACTIVE_ORDER_STATUSES = Order.ACTIVE_ORDER_STATUSES
ASAP_REMINDER_STATUSES = Order.ACTIVE_ORDER_STATUSES
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


def _order_items_desc(order) -> str:
    items = list(order.order_items.select_related('item').all())
    return ', '.join(f'{oi.item.title} x{oi.quantity}' for oi in items) if items else 'Unknown item'


def _order_items_short(order) -> str:
    items = list(order.order_items.select_related('item').all())
    return ', '.join(oi.item.title for oi in items) if items else 'Unknown item'


def _first_order_item(order):
    oi = order.order_items.select_related('item').first()
    return oi.item if oi else None


def _item_thumbnail_url(order) -> str:
    item = _first_order_item(order)
    if not item:
        return ''
    image_path = (item.image_path or '').strip()
    if image_path.startswith(('http://', 'https://')):
        return image_path

    images_manager = getattr(item, 'images', None)
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
    items = list(order.order_items.select_related('item').all())
    subtotal = sum(Decimal(str(oi.price_at_purchase or 0)) * oi.quantity for oi in items)
    subtotal = subtotal.quantize(Decimal('0.01')) - _order_discount(order)
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


def _admin_dispatch_url() -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/admin/dispatch"


def _order_user_email(order) -> str:
    return order.user.email if order.user else 'deleted-user'


def _buyer_discord_mention(order) -> str:
    if not order.user:
        return 'deleted-user'
    profile = UserProfile.objects.filter(user=order.user).only('discord_id').first()
    if profile and profile.discord_id:
        return f'<@{profile.discord_id}>'
    return _order_user_email(order)


def _linked_admin_profiles():
    return UserProfile.objects.filter(
        user__is_admin=True,
        discord_id__isnull=False,
    ).exclude(discord_id='').select_related('user')


def _admin_order_fields(order, now=None) -> list[dict[str, object]]:
    now = now or _heartbeat_now()
    fields: list[dict[str, object]] = [
        {'name': 'Customer', 'value': _order_user_email(order), 'inline': True},
        {'name': 'Item', 'value': _order_items_desc(order), 'inline': True},
        {'name': 'Status', 'value': _status_label(order.status), 'inline': True},
        {'name': 'Order', 'value': str(order.order_id), 'inline': False},
        {'name': 'Created', 'value': timezone.localtime(order.created_at).strftime('%b %d, %I:%M %p'), 'inline': True},
        {'name': 'Order Age', 'value': _format_duration(now - order.created_at), 'inline': True},
    ]

    if order.status == 'cash_needed':
        fields.append({'name': 'Balance Due', 'value': _money(_order_cash_due(order)), 'inline': True})

    return fields[:25]


def _build_admin_asap_dm_payload(order, *, title: str, description: str, color: str, now=None) -> dict[str, object]:
    return {
        'title': title,
        'description': description,
        'color': color,
        'url': _admin_dispatch_url(),
        'fields': _admin_order_fields(order, now=now),
        'button': {'label': 'Open Dispatch', 'url': _admin_dispatch_url()},
    }


def _build_order_fields(order) -> list[dict[str, object]]:
    items = list(order.order_items.select_related('item').all())
    total_qty = sum(oi.quantity for oi in items) if items else (order.quantity or 1)
    fields: list[dict[str, object]] = [
        {'name': 'Item', 'value': _order_items_short(order), 'inline': True},
        {'name': 'Quantity', 'value': str(total_qty), 'inline': True},
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
    title = _order_items_short(order)
    if order.delivery_method == 'asap':
        return (
            f'Your order for {title} is active and ready for downtown pickup coordination. '
            'Open the order page for the latest details.'
        )
    return (
        f'Your order for {title} is active and moving through the shop queue. '
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
    title = _order_items_short(order)
    if trade_credit > 0:
        return (
            f'Your order for {title} is still active. We applied the approved trade credit, '
            f'and the remaining balance is {cash_due}.'
        )
    if order.buy_if_trade_denied:
        return (
            f'Your order for {title} is still active and now needs a cash payment of {cash_due} '
            'to finish checkout.'
        )
    return f'Your order for {title} is still active and the current balance due is {cash_due}.'


def build_order_status_dm(order) -> dict[str, object] | None:
    if order.status == 'pending':
        # If an admin created this order on the customer's behalf, use a
        # context-specific message so the customer isn't confused.
        if order.created_by_id:
            return _build_order_dm_payload(
                order,
                title='An Order Was Created for You',
                description=(
                    f'A shop admin has placed an order on your behalf for '
                    f'{_order_items_short(order)}. '
                    f'You did not place this order yourself — if you have any '
                    f'questions please contact the shop.'
                ),
                color=PROCESSING_BLUE,
                button_label='View Order',
            )
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
            description=f'Your order for {_order_items_short(order)} is processing and your trade-in is under review.',
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
            description=f'Your order for {_order_items_short(order)} has a counteroffer waiting for your review.',
            color=ACTION_GOLD,
            button_label='Review Counteroffer',
            extra_fields=extra_fields,
        )
    if order.status == 'fulfilled':
        return _build_order_dm_payload(
            order,
            title='Order Update: Completed',
            description=f'Your order for {_order_items_short(order)} has been completed. Open the order page for the latest pickup details.',
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
        cancellation_reason = (order.cancellation_reason or '').strip()
        cancelled_by_shop = bool(order.cancelled_by_id and cancellation_reason)
        if cancelled_by_shop:
            return _build_order_dm_payload(
                order,
                title='Order Update: Cancelled by Shop',
                description=(
                    f'Your order for {_order_items_short(order)} was cancelled by the shop. '
                    f'Reason: {cancellation_reason}'
                ),
                color=ISSUE_RED,
                button_label='View Order',
            )
        return _build_order_dm_payload(
            order,
            title='Order Update: Cancelled',
            description=f'Your order for {_order_items_short(order)} has been cancelled.',
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

    def _send():
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
        except requests.RequestException:
            logger.exception('Failed to send Discord DM for user %s', user.pk)

    threading.Thread(target=_send, daemon=True).start()
    return True


def notify_order_status_via_dm(order) -> bool:
    payload = build_order_status_dm(order)
    if not payload:
        return False
    return send_discord_dm(order.user, **payload)


def notify_new_asap_order_to_admins(order) -> bool:
    if order.delivery_method != 'asap':
        return False

    admin_profiles = list(_linked_admin_profiles())
    if not admin_profiles:
        return False

    payload = _build_admin_asap_dm_payload(
        order,
        title='New ASAP Order',
        description=(
            f'🚨 New ASAP Order! Customer {_buyer_discord_mention(order)} is waiting. '
            'You have 24 hours to coordinate and acknowledge.'
        ),
        color=ISSUE_RED,
    )

    sent_any = False
    for admin_profile in admin_profiles:
        sent_any = send_discord_dm(admin_profile.user, **payload) or sent_any
    return sent_any


def notify_order_merged(order, added_items_desc: list[str]) -> bool:
    """Notify admins via Discord DM that an order was updated via cart merge."""
    admin_profiles = list(_linked_admin_profiles())
    if not admin_profiles:
        return False

    items_text = ', '.join(added_items_desc) if added_items_desc else 'Unknown items'
    new_subtotal = _order_subtotal_after_discount(order)
    short_id = str(order.order_id)[:8]

    payload = _build_admin_asap_dm_payload(
        order,
        title='Order Updated',
        description=(
            f'⚠️ {_order_user_email(order)} added {len(added_items_desc)} item(s) to Order #{short_id}.\n'
            f'**New items:** {items_text}\n'
            f'**New subtotal:** {_money(new_subtotal)}'
        ),
        color=ACTION_GOLD,
    )

    sent_any = False
    for admin_profile in admin_profiles:
        sent_any = send_discord_dm(admin_profile.user, **payload) or sent_any
    return sent_any


def _remaining_hours_label(now, created_at) -> str:
    remaining_seconds = max(0, int((ASAP_ACK_DEADLINE - (now - created_at)).total_seconds()))
    remaining_hours = max(1, (remaining_seconds + 3599) // 3600)
    if remaining_hours == 1:
        return '1 hour'
    return f'{remaining_hours} hours'


def _due_asap_reminder_level(order, now):
    if order.is_acknowledged:
        return None

    age = now - order.created_at
    if age >= ASAP_ACK_DEADLINE:
        return None

    next_level = order.asap_reminder_level
    for level, threshold in ASAP_REMINDER_THRESHOLDS:
        if age >= threshold:
            next_level = level
    return next_level if next_level > order.asap_reminder_level else None


def build_asap_reminder_dm(order, level: int, now=None) -> dict[str, object]:
    now = now or _heartbeat_now()
    return _build_admin_asap_dm_payload(
        order,
        title='ASAP Order Reminder',
        description=(
            f'⏳ Reminder: ASAP order from {_buyer_discord_mention(order)} '
            f'expiring in {_remaining_hours_label(now, order.created_at)}!'
        ),
        color=ISSUE_RED if level >= 3 else ACTION_GOLD,
        now=now,
    )


def _append_timeline_event(order, event, detail=''):
    if not isinstance(order.resolution_summary, list):
        order.resolution_summary = []
    order.resolution_summary.append({
        'timestamp': timezone.now().isoformat(),
        'event': event,
        'detail': detail,
    })


def _cancel_expired_unacknowledged_asap_orders(now=None) -> int:
    now = now or _heartbeat_now()
    cutoff = now - ASAP_ACK_DEADLINE
    cancelled_count = 0

    from inventory.models import Item

    expired_orders = (
        Order.objects.select_for_update(of=('self',))
        .filter(
            delivery_method='asap',
            is_acknowledged=False,
            status__in=ASAP_REMINDER_STATUSES,
            created_at__lte=cutoff,
        )
        .prefetch_related('order_items__item')
        .order_by('created_at')
    )

    with transaction.atomic():
        for order in expired_orders:
            for oi in order.order_items.all():
                item = Item.objects.select_for_update().get(pk=oi.item_id)
                item.stock += oi.quantity
                item.save(update_fields=['stock'])

            if order.pickup_slot:
                order.pickup_slot.is_claimed = False
                order.pickup_slot.save(update_fields=['is_claimed'])

            order.status = 'cancelled'
            order.cancelled_at = now
            _append_timeline_event(
                order,
                'asap_expired',
                'ASAP order auto-cancelled after 24 hours without admin acknowledgement.',
            )
            order.save(update_fields=['status', 'cancelled_at', 'resolution_summary'])

            if order.pickup_timeslot:
                order.pickup_timeslot.refresh_current_bookings(save=True)

            cancelled_count += 1

    return cancelled_count


def _reserve_due_asap_reminder_actions(now=None) -> list[dict[str, object]]:
    now = now or _heartbeat_now()
    actions: list[dict[str, object]] = []

    _cancel_expired_unacknowledged_asap_orders(now=now)

    admin_profiles = list(_linked_admin_profiles())
    if not admin_profiles:
        return actions

    orders = (
        Order.objects.select_for_update(of=('self',)).filter(
            delivery_method='asap',
            is_acknowledged=False,
            status__in=ASAP_REMINDER_STATUSES,
            asap_reminder_level__lt=len(ASAP_REMINDER_THRESHOLDS),
        )
        .select_related('user')
        .prefetch_related('order_items__item__images')
        .order_by('created_at')
    )

    with transaction.atomic():
        for order in orders:
            due_level = _due_asap_reminder_level(order, now)
            if not due_level:
                continue

            order.asap_reminder_level = due_level
            order.save(update_fields=['asap_reminder_level'])

            payload = build_asap_reminder_dm(order, due_level, now=now)
            for admin_profile in admin_profiles:
                actions.append({
                    'type': 'dm',
                    'discord_id': admin_profile.discord_id,
                    **payload,
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
            oldest_lines.append(f'• {str(order.order_id)[:8]} • {_order_user_email(order)} • {_status_label(order.status)} • {age}')
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