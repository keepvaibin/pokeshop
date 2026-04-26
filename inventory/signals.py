from datetime import timedelta

from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.utils import timezone

from .models import RecurringTimeslot


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
