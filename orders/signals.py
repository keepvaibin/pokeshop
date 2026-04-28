from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from users.models import UserProfile

from .discord_pickup_roles import handle_order_pickup_role_events, enqueue_grants_for_profile, profile_discord_id_for_user
from .models import Order, SupportTicket
from .services import notify_new_asap_order_to_admins, notify_order_status_via_dm


@receiver(pre_save, sender=Order)
def capture_previous_order_status(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_status = None
        instance._previous_pickup_role_state = None
        return
    previous = sender.objects.select_related('user', 'user__profile').filter(pk=instance.pk).first()
    instance._previous_status = previous.status if previous else None
    instance._previous_pickup_role_state = {
        'status': previous.status,
        'delivery_method': previous.delivery_method,
        'pickup_date': previous.pickup_date,
        'user_id': previous.user_id,
        'discord_id': profile_discord_id_for_user(previous.user),
    } if previous else None


@receiver(post_save, sender=Order)
def send_order_notifications(sender, instance, created, **kwargs):
    previous_status = getattr(instance, '_previous_status', None)
    previous_pickup_role_state = getattr(instance, '_previous_pickup_role_state', None)

    if created and instance.delivery_method == 'asap':
        transaction.on_commit(lambda: notify_new_asap_order_to_admins(instance))

    if created or previous_status != instance.status:
        transaction.on_commit(lambda: notify_order_status_via_dm(instance))

    transaction.on_commit(lambda: handle_order_pickup_role_events(
        instance.pk,
        created=created,
        previous_state=previous_pickup_role_state,
    ))


@receiver(pre_save, sender=UserProfile)
def capture_previous_discord_id(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_discord_id = None
        return
    instance._previous_discord_id = sender.objects.filter(pk=instance.pk).values_list('discord_id', flat=True).first()


@receiver(post_save, sender=UserProfile)
def send_late_linker_pickup_role_events(sender, instance, created, **kwargs):
    previous_discord_id = str(getattr(instance, '_previous_discord_id', '') or '').strip()
    current_discord_id = str(instance.discord_id or '').strip()
    if current_discord_id and current_discord_id != previous_discord_id:
        transaction.on_commit(lambda: enqueue_grants_for_profile(instance.pk))


@receiver(post_save, sender=SupportTicket)
def send_support_ticket_audit(sender, instance, created, **kwargs):
    return