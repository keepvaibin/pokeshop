from collections import OrderedDict
from decimal import Decimal


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal('0.01'))


def item_image_path(item) -> str:
    image_path = (getattr(item, 'image_path', '') or '').strip()
    if image_path:
        return image_path

    images = getattr(item, 'images', None)
    if images is None:
        return ''
    try:
        first_image = images.all().first()
    except Exception:
        return ''
    if not first_image:
        return ''
    return getattr(first_image.image, 'url', '') or ''


def grouped_order_items(order):
    groups = OrderedDict()
    raw_items = list(order.order_items.select_related('item').all()) if getattr(order, 'pk', None) else []

    for order_item in raw_items:
        item = order_item.item
        key = order_item.item_id
        group = groups.get(key)
        line_subtotal = _money(order_item.price_at_purchase) * int(order_item.quantity or 0)

        if group is None:
            group = {
                'id': order_item.id,
                'item': order_item.item_id,
                'item_title': item.title,
                'quantity': 0,
                'price_at_purchase': str(_money(order_item.price_at_purchase)),
                'subtotal': Decimal('0.00'),
                'image_path': item_image_path(item),
                'order_item_ids': [],
            }
            groups[key] = group
        elif group['price_at_purchase'] != str(_money(order_item.price_at_purchase)):
            group['price_at_purchase'] = None

        group['quantity'] += int(order_item.quantity or 0)
        group['subtotal'] += line_subtotal
        group['order_item_ids'].append(order_item.id)

    if groups:
        return list(groups.values())

    if getattr(order, 'item_id', None):
        quantity = int(order.quantity or 1)
        unit_price = _money(getattr(order.item, 'price', 0))
        return [{
            'id': None,
            'item': order.item_id,
            'item_title': order.item.title,
            'quantity': quantity,
            'price_at_purchase': str(unit_price),
            'subtotal': unit_price * quantity,
            'image_path': item_image_path(order.item),
            'order_item_ids': [],
        }]

    return []


def grouped_order_items_payload(order):
    payload = []
    for group in grouped_order_items(order):
        payload.append({
            **group,
            'subtotal': str(_money(group['subtotal'])),
        })
    return payload


def format_order_items(order, *, include_quantity=True) -> str:
    groups = grouped_order_items(order)
    if not groups:
        return 'Unknown item'
    if include_quantity:
        return ', '.join(f'{group["item_title"]} x{group["quantity"]}' for group in groups)
    return ', '.join(group['item_title'] for group in groups)