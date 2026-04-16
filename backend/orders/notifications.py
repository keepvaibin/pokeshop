"""Discord webhook notifications for order events."""

import logging
import threading
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)


def _is_valid_discord_url(url: str) -> bool:
    """Basic validation that this looks like a Discord webhook URL."""
    if not url:
        return False
    parsed = urlparse(url)
    return (
        parsed.scheme == 'https'
        and parsed.hostname in ('discord.com', 'discordapp.com')
        and '/api/webhooks/' in parsed.path
    )


def send_discord_notification(webhook_url: str, embed: dict) -> bool:
    """Fire a Discord embed via webhook in a background thread. Returns True immediately if URL is valid."""
    if not _is_valid_discord_url(webhook_url):
        return False

    def _send():
        try:
            resp = requests.post(
                webhook_url,
                json={'embeds': [embed]},
                timeout=5,
            )
            resp.raise_for_status()
        except Exception:
            logger.exception('Discord webhook failed')

    threading.Thread(target=_send, daemon=True).start()
    return True


def _order_items_label(order):
    items = list(order.order_items.select_related('item').all())
    return ', '.join(f'{oi.item.title} x{oi.quantity}' for oi in items) if items else 'Unknown item'


def notify_new_order(order):
    """Send a notification when a new order is created."""
    from inventory.models import PokeshopSettings
    settings = PokeshopSettings.load()
    url = settings.discord_webhook_url
    if not url:
        return

    trade_info = ''
    if order.trade_offer:
        trade_info = f'\nTrade Credit: ${order.trade_offer.total_credit}'
        trade_info += f' ({order.trade_offer.cards.count()} cards)'

    items = list(order.order_items.select_related('item').all())
    total_qty = sum(oi.quantity for oi in items)
    item_label = _order_items_label(order)

    embed = {
        'title': 'New Order',
        'color': 0x3B82F6,  # blue
        'fields': [
            {'name': 'Item', 'value': item_label, 'inline': True},
            {'name': 'Qty', 'value': str(total_qty), 'inline': True},
            {'name': 'Payment', 'value': order.get_payment_method_display(), 'inline': True},
            {'name': 'Customer', 'value': order.discord_handle or order.user.email, 'inline': True},
            {'name': 'Status', 'value': order.status, 'inline': True},
        ],
    }
    if trade_info:
        embed['fields'].append({'name': 'Trade', 'value': trade_info.strip(), 'inline': False})

    send_discord_notification(url, embed)


def notify_order_status_change(order, action: str):
    """Send a notification when an order status changes via dispatch."""
    from inventory.models import PokeshopSettings
    settings = PokeshopSettings.load()
    url = settings.discord_webhook_url
    if not url:
        return

    color_map = {
        'fulfill': 0x22C55E,      # green
        'approve_trade': 0x22C55E,
        'deny_trade': 0xEF4444,    # red
        'cancel': 0xEF4444,
        'review_partial_trade': 0xF59E0B,  # amber
        'send_counteroffer': 0xF59E0B,     # amber
        'counteroffer_accepted': 0x22C55E, # green
        'counteroffer_declined': 0xEF4444, # red
        'counteroffer_pay_cash': 0x3B82F6, # blue
    }

    embed = {
        'title': f'Order Update: {action.replace("_", " ").title()}',
        'color': color_map.get(action, 0x6B7280),
        'fields': [
            {'name': 'Order', 'value': f'#{order.id}', 'inline': True},
            {'name': 'Item', 'value': _order_items_label(order), 'inline': True},
            {'name': 'Customer', 'value': order.discord_handle or order.user.email, 'inline': True},
            {'name': 'New Status', 'value': order.status, 'inline': True},
        ],
    }
    send_discord_notification(url, embed)
