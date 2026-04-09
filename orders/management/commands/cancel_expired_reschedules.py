"""
cancel_expired_reschedules — Auto-cancel orders whose reschedule deadline has passed.

Run via cron every 5 minutes:
    python manage.py cancel_expired_reschedules
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from orders.models import Order
from inventory.models import Item


class Command(BaseCommand):
    help = 'Cancel orders whose reschedule deadline has expired'

    def handle(self, *args, **options):
        expired_orders = Order.objects.filter(
            requires_rescheduling=True,
            reschedule_deadline__lt=timezone.now(),
            status__in=['pending', 'trade_review', 'cash_needed'],
        )

        cancelled_count = 0
        for order in expired_orders:
            try:
                with transaction.atomic():
                    order = Order.objects.select_for_update().get(pk=order.pk)
                    if not order.requires_rescheduling or order.status == 'cancelled':
                        continue

                    # Restore stock
                    item = Item.objects.select_for_update().get(id=order.item_id)
                    item.stock += order.quantity
                    item.save()

                    # Release timeslot bookings
                    if order.pickup_slot:
                        order.pickup_slot.is_claimed = False
                        order.pickup_slot.save()
                    if order.pickup_timeslot:
                        order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
                        order.pickup_timeslot.save()

                    order.status = 'cancelled'
                    order.cancelled_at = timezone.now()
                    order.cancellation_penalty = True
                    order.requires_rescheduling = False
                    order.save()
                    cancelled_count += 1
            except Exception as e:
                self.stderr.write(f'Failed to cancel order {order.pk}: {e}')

        if cancelled_count:
            self.stdout.write(self.style.SUCCESS(f'Cancelled {cancelled_count} expired reschedule orders'))
        else:
            self.stdout.write('No expired reschedule orders found')
