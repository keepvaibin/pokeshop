from django.core.management.base import BaseCommand

from orders.discord_pickup_roles import enqueue_grant_for_order
from orders.models import DiscordRoleEvent, Order


class Command(BaseCommand):
    help = 'Enqueue pickup-role grants for active scheduled pickup orders that should currently have Discord access.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Report what would be enqueued without writing events.')

    def handle(self, *args, **options):
        dry_run = bool(options.get('dry_run'))
        active_orders = Order.objects.select_related('user', 'user__profile').filter(
            delivery_method='scheduled',
            pickup_date__isnull=False,
            status__in=Order.ACTIVE_ORDER_STATUSES,
        ).order_by('pickup_date', 'id')

        missing_discord_id = 0
        enqueued = 0
        already_pending = 0
        for order in active_orders:
            profile = getattr(order.user, 'profile', None) if order.user_id else None
            discord_id = str(getattr(profile, 'discord_id', '') or '').strip()
            if not discord_id:
                missing_discord_id += 1
                continue

            if dry_run:
                enqueued += 1
                continue

            existing_event_ids = set(DiscordRoleEvent.objects.filter(
                event_type=DiscordRoleEvent.EVENT_GRANT,
                discord_id=discord_id,
                pickup_date=order.pickup_date,
                status__in=[
                    DiscordRoleEvent.STATUS_PENDING,
                    DiscordRoleEvent.STATUS_PROCESSING,
                    DiscordRoleEvent.STATUS_FAILED,
                ],
            ).values_list('id', flat=True))
            event = enqueue_grant_for_order(order, reason='pickup_role_repair')
            if event:
                if event.id in existing_event_ids:
                    already_pending += 1
                else:
                    enqueued += 1

        action = 'Would enqueue' if dry_run else 'Enqueued'
        self.stdout.write(self.style.SUCCESS(
            f'{action} {enqueued} pickup-role grant event(s); '
            f'{already_pending} already had pending/processing/failed events; '
            f'{missing_discord_id} active pickup order(s) have no linked Discord ID.'
        ))