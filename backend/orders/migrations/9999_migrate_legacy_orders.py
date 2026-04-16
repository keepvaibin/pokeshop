from django.db import migrations, transaction
from decimal import Decimal

def migrate_legacy_orders(apps, schema_editor):
    Order = apps.get_model('orders', 'Order')
    OrderItem = apps.get_model('orders', 'OrderItem')
    Item = apps.get_model('inventory', 'Item')

    legacy_orders = Order.objects.filter(order_items__isnull=True).exclude(item__isnull=True)
    with transaction.atomic():
        for order in legacy_orders:
            if not order.item or not order.quantity:
                continue
            # Use price at time of migration (could be improved if historical price is available)
            price = order.item.price if hasattr(order.item, 'price') else Decimal('0.00')
            OrderItem.objects.create(
                order=order,
                item=order.item,
                quantity=order.quantity,
                price_at_purchase=price,
            )
            # Optionally, clear legacy fields
            # order.item = None
            # order.quantity = None
            # order.save(update_fields=['item', 'quantity'])

class Migration(migrations.Migration):
    dependencies = [
        ('orders', '0001_initial'),
        ('inventory', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(migrate_legacy_orders),
    ]
