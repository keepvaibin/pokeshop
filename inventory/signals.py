from datetime import timedelta

from django.db.models.signals import pre_delete, post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import RecurringTimeslot, Item


@receiver(post_save, sender=Item)
def auto_deactivate_out_of_stock(sender, instance, **kwargs):
    """Auto-deactivate items that hit zero stock."""
    if instance.stock <= 0 and instance.is_active:
        instance.is_active = False
        instance.save(update_fields=['is_active'])


@receiver(pre_delete, sender=RecurringTimeslot)
def flag_orders_for_rescheduling(sender, instance, **kwargs):
    """When an admin deletes a booked timeslot, flag affected orders for rescheduling."""
    from orders.models import Order

    affected_orders = Order.objects.filter(
        recurring_timeslot=instance,
        status__in=Order.ACTIVE_SLOT_STATUSES,
    )
    deadline = timezone.now() + timedelta(hours=24)
    affected_orders.update(
        requires_rescheduling=True,
        reschedule_deadline=deadline,
    )
