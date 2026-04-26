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
    rows = [
        f'• {item.quantity}x {item.card_name} ({item.condition})'
        for item in request_obj.items.all()[:25]
    ]
    return '\n'.join(rows) if rows else 'No items listed.'


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
        f'Submission: **{request_obj.get_submission_method_display()}**\n'
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
            button={'label': 'Review Trade-Ins', 'url': _admin_trade_ins_url()},
        )
        if ok:
            sent += 1
    return sent


def notify_customer_trade_in_approved(request_obj) -> bool:
    payout = _money(request_obj.final_payout_value or Decimal('0'))
    method_label = request_obj.get_submission_method_display()
    description = (
        f'Great news — your trade-in has been reviewed!\n\n'
        f'We\'re offering **{payout}** in store credit. '
        f'Please {("ship" if request_obj.submission_method == "mail_in" else "drop off")} '
        f'your cards via **{method_label}**. Once we receive and verify them, '
        f'your wallet will be funded automatically.'
    )
    if request_obj.admin_notes:
        description += f'\n\n**Notes from the shop:** {request_obj.admin_notes}'
    return send_discord_dm(
        request_obj.user,
        title='Trade-In Approved — Send Your Cards',
        description=description,
        color=ACTION_GOLD,
        url=_trade_in_url(request_obj),
        button={'label': 'View Trade-In', 'url': _trade_in_url(request_obj)},
    )


def notify_customer_trade_in_completed(request_obj, new_balance) -> bool:
    payout = _money(request_obj.final_payout_value or Decimal('0'))
    description = (
        f'We received your cards! **{payout}** has been added to your '
        f'SCTCG store credit wallet.\n\n'
        f'**Current balance:** {_money(new_balance)}\n\n'
        f'Use it on your next order at checkout.'
    )
    return send_discord_dm(
        request_obj.user,
        title='Wallet Funded — Trade-In Complete',
        description=description,
        color=SUCCESS_GREEN,
        url=_trade_in_url(request_obj),
        button={'label': 'View Wallet', 'url': f"{settings.FRONTEND_URL.rstrip('/')}/orders"},
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
        button={'label': 'View Trade-In', 'url': _trade_in_url(request_obj)},
    )
