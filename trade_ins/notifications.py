"""Discord notification helpers for the trade-in lifecycle.

These reuse the existing `send_discord_dm` plumbing in `orders.services` so
we don't duplicate the bot HTTP transport. Customer DMs follow the same
visual language as order DMs (blue=processing, gold=action-needed,
green=success, red=issue).
"""
from decimal import Decimal

from django.conf import settings

from orders.services import (
    PROCESSING_BLUE,
    ACTION_GOLD,
    SUCCESS_GREEN,
    ISSUE_RED,
    send_discord_dm,
    _money,
)


def _trade_in_url(request_obj) -> str:
    base = settings.FRONTEND_URL.rstrip('/')
    return f'{base}/trade-in/{request_obj.id}'


def _admin_trade_ins_url() -> str:
    base = settings.FRONTEND_URL.rstrip('/')
    return f'{base}/admin/trade-ins'


def _items_summary(request_obj) -> str:
    rows = []
    for item in request_obj.items.all()[:25]:
        decision = ''
        if item.is_accepted is True:
            unit = item.admin_override_value if item.admin_override_value is not None else item.user_estimated_price
            decision = f' — accepted at {_money(unit)} each'
        elif item.is_accepted is False:
            decision = ' — rejected'
        rows.append(f'• {item.quantity}x {item.card_name} ({item.condition}){decision}')
    return '\n'.join(rows) if rows else 'No items listed.'


def _trade_in_thumbnail_url(request_obj) -> str:
    for item in request_obj.items.all():
        if item.image_url:
            return item.image_url
    return ''


def _trade_in_counts(request_obj) -> tuple[int, int, int, int]:
    total_cards = 0
    accepted_cards = 0
    rejected_cards = 0
    pending_cards = 0
    for item in request_obj.items.all():
        quantity = int(item.quantity or 0)
        total_cards += quantity
        if item.is_accepted is True:
            accepted_cards += quantity
        elif item.is_accepted is False:
            rejected_cards += quantity
        else:
            pending_cards += quantity
    return total_cards, accepted_cards, rejected_cards, pending_cards


def _trade_in_fields(request_obj, *, include_deadline: bool = False) -> list[dict]:
    total_cards, accepted_cards, rejected_cards, pending_cards = _trade_in_counts(request_obj)
    payout_value = request_obj.final_payout_value if request_obj.final_payout_value is not None else request_obj.estimated_total_value
    fields = [
        {'name': 'Payout', 'value': _payout_summary(request_obj), 'inline': True},
        {'name': 'Offer', 'value': _money(payout_value), 'inline': True},
        {'name': 'Drop-Off', 'value': _pickup_summary(request_obj), 'inline': False},
        {'name': 'Cards', 'value': str(total_cards), 'inline': True},
    ]
    if accepted_cards or rejected_cards or pending_cards:
        review_chunks = []
        if accepted_cards:
            review_chunks.append(f'{accepted_cards} accepted')
        if rejected_cards:
            review_chunks.append(f'{rejected_cards} rejected')
        if pending_cards:
            review_chunks.append(f'{pending_cards} pending')
        fields.append({'name': 'Review', 'value': ', '.join(review_chunks), 'inline': True})
    if include_deadline and request_obj.counteroffer_expires_at:
        fields.append({
            'name': 'Respond By',
            'value': request_obj.counteroffer_expires_at.strftime('%b %d, %I:%M %p'),
            'inline': True,
        })
    return fields


def _pickup_summary(request_obj) -> str:
    if request_obj.recurring_timeslot and request_obj.pickup_date:
        readable_date = request_obj.pickup_date.strftime('%A, %b %d').replace(' 0', ' ')
        return f'{readable_date} • {request_obj.recurring_timeslot}'
    return request_obj.get_submission_method_display()


def _payout_summary(request_obj) -> str:
    if request_obj.payout_type == request_obj.PAYOUT_TYPE_CASH and request_obj.cash_payment_method:
        return f'Cash via {request_obj.get_cash_payment_method_display()}'
    return 'Store Credit'


def notify_admins_new_trade_in(request_obj) -> int:
    """DM all admins (with linked Discord) about a freshly submitted trade-in."""
    from users.models import UserProfile

    admin_profiles = (
        UserProfile.objects
        .filter(user__is_admin=True, discord_id__isnull=False)
        .exclude(discord_id='')
        .select_related('user')
    )

    description = (
        f'New trade-in from **{request_obj.user.email}**.\n\n'
        f'Pickup: **{_pickup_summary(request_obj)}**\n'
        f'Payout: **{_payout_summary(request_obj)}**\n'
        f'Customer estimate: **{_money(request_obj.estimated_total_value)}**\n\n'
        f'**Items:**\n{_items_summary(request_obj)}'
    )

    sent = 0
    for profile in admin_profiles:
        ok = send_discord_dm(
            profile.user,
            title='New Trade-In Submitted',
            description=description,
            color=ACTION_GOLD,
            url=_admin_trade_ins_url(),
            fields=_trade_in_fields(request_obj),
            thumbnail_url=_trade_in_thumbnail_url(request_obj),
            button={'label': 'Review Trade-Ins', 'url': _admin_trade_ins_url()},
        )
        if ok:
            sent += 1
    return sent


def notify_customer_trade_in_approved(request_obj) -> bool:
    payout = _money(request_obj.final_payout_value or Decimal('0'))
    method_label = request_obj.get_submission_method_display()
    pickup_label = _pickup_summary(request_obj)
    if request_obj.payout_type == request_obj.PAYOUT_TYPE_CASH and request_obj.cash_payment_method:
        description = (
            f'Great news — your trade-in has been reviewed!\n\n'
            f'We\'re offering **{payout}** in cash via **{request_obj.get_cash_payment_method_display()}**. '
            f'Please bring your cards to your **{method_label}** at **{pickup_label}**. Once we receive and verify them, '
            f'we\'ll send your payout through **{request_obj.get_cash_payment_method_display()}**.'
        )
    else:
        description = (
            f'Great news — your trade-in has been reviewed!\n\n'
            f'We\'re offering **{payout}** in store credit. '
            f'Please bring your cards to your **{method_label}** at **{pickup_label}**. Once we receive and verify them, '
            f'your wallet will be funded automatically.'
        )
    if request_obj.admin_notes:
        description += f'\n\n**Notes from the shop:** {request_obj.admin_notes}'
    return send_discord_dm(
        request_obj.user,
        title='Trade-In Approved - Bring Your Cards',
        description=description,
        color=ACTION_GOLD,
        url=_trade_in_url(request_obj),
        fields=_trade_in_fields(request_obj),
        thumbnail_url=_trade_in_thumbnail_url(request_obj),
        button={'label': 'View Trade-In', 'url': _trade_in_url(request_obj)},
    )


def notify_customer_trade_in_completed(request_obj, new_balance) -> bool:
    payout = _money(request_obj.final_payout_value or Decimal('0'))
    if request_obj.payout_type == request_obj.PAYOUT_TYPE_CASH and request_obj.cash_payment_method:
        description = (
            f'We received your cards! Your **{payout}** cash payout has been approved '
            f'for **{request_obj.get_cash_payment_method_display()}**.\n\n'
            f'If you do not see it shortly, reply in Discord so we can verify the transfer.'
        )
        title = 'Trade-In Complete — Cash Payout Sent'
        button = {'label': 'View Trade-In', 'url': _trade_in_url(request_obj)}
    else:
        description = (
            f'We received your cards! **{payout}** has been added to your '
            f'SCTCG store credit wallet.\n\n'
            f'**Current balance:** {_money(new_balance)}\n\n'
            f'Use it on your next order at checkout.'
        )
        title = 'Wallet Funded — Trade-In Complete'
        button = {'label': 'View Wallet', 'url': f"{settings.FRONTEND_URL.rstrip('/')}/orders"}
    return send_discord_dm(
        request_obj.user,
        title=title,
        description=description,
        color=SUCCESS_GREEN,
        url=_trade_in_url(request_obj),
        fields=_trade_in_fields(request_obj),
        thumbnail_url=_trade_in_thumbnail_url(request_obj),
        button=button,
    )


def notify_customer_trade_in_counteroffer(request_obj) -> bool:
    payout = _money(request_obj.final_payout_value or Decimal('0'))
    description = (
        f'Your trade-in has a counteroffer ready for review.\n\n'
        f'Current {_payout_summary(request_obj).lower()} offer: **{payout}**. '
        f'Accepted and rejected cards are listed below and on the trade-in page.\n\n'
        f'**Items:**\n{_items_summary(request_obj)}'
    )
    if request_obj.counteroffer_message:
        description += f'\n\n**Notes from the shop:** {request_obj.counteroffer_message}'
    if request_obj.counteroffer_expires_at:
        description += f'\n\nPlease respond before **{request_obj.counteroffer_expires_at.strftime("%b %d, %I:%M %p")}**.'
    return send_discord_dm(
        request_obj.user,
        title='Trade-In Counteroffer Ready',
        description=description,
        color=ACTION_GOLD,
        url=_trade_in_url(request_obj),
        fields=_trade_in_fields(request_obj, include_deadline=True),
        thumbnail_url=_trade_in_thumbnail_url(request_obj),
        button={'label': 'Review Counteroffer', 'url': _trade_in_url(request_obj)},
    )


def notify_customer_trade_in_rejected(request_obj) -> bool:
    description = (
        f'Your trade-in request was reviewed and unfortunately could not be approved.'
    )
    if request_obj.admin_notes:
        description += f'\n\n**Reason:** {request_obj.admin_notes}'
    return send_discord_dm(
        request_obj.user,
        title='Trade-In Update: Not Approved',
        description=description,
        color=ISSUE_RED,
        url=_trade_in_url(request_obj),
        fields=_trade_in_fields(request_obj),
        thumbnail_url=_trade_in_thumbnail_url(request_obj),
        button={'label': 'View Trade-In', 'url': _trade_in_url(request_obj)},
    )


def notify_admins_trade_in_counteroffer_response(request_obj, *, accepted: bool) -> int:
    from users.models import UserProfile

    admin_profiles = (
        UserProfile.objects
        .filter(user__is_admin=True, discord_id__isnull=False)
        .exclude(discord_id='')
        .select_related('user')
    )
    decision = 'accepted' if accepted else 'declined'
    description = (
        f'**{request_obj.user.email}** {decision} the trade-in counteroffer for '
        f'**{_money(request_obj.final_payout_value or Decimal("0"))}** ({_payout_summary(request_obj)}).\n\n'
        f'**Items:**\n{_items_summary(request_obj)}'
    )
    sent = 0
    for profile in admin_profiles:
        ok = send_discord_dm(
            profile.user,
            title=f'Trade-In Counteroffer {decision.title()}',
            description=description,
            color=SUCCESS_GREEN if accepted else ISSUE_RED,
            url=_admin_trade_ins_url(),
            fields=_trade_in_fields(request_obj),
            thumbnail_url=_trade_in_thumbnail_url(request_obj),
            button={'label': 'Open Trade-Ins', 'url': _admin_trade_ins_url()},
        )
        if ok:
            sent += 1
    return sent
