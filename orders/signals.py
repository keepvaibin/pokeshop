from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .models import Order, SupportTicket
from .services import notify_order_status_via_dm


@receiver(pre_save, sender=Order)
def capture_previous_order_status(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_status = None
        return
    instance._previous_status = sender.objects.filter(pk=instance.pk).values_list('status', flat=True).first()


@receiver(post_save, sender=Order)
def send_order_notifications(sender, instance, created, **kwargs):
    previous_status = getattr(instance, '_previous_status', None)

    if created or previous_status != instance.status:
        transaction.on_commit(lambda: notify_order_status_via_dm(instance))


@receiver(post_save, sender=SupportTicket)
def send_support_ticket_audit(sender, instance, created, **kwargs):
    return