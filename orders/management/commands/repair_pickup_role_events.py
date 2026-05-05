from django.core.management.base import BaseCommand

from orders.discord_pickup_roles import enqueue_missing_active_pickup_role_grants


class Command(BaseCommand):
    help = 'Enqueue pickup-role grants for active scheduled pickup orders that should currently have Discord access.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Report what would be enqueued without writing events.')

    def handle(self, *args, **options):
        dry_run = bool(options.get('dry_run'))
        result = enqueue_missing_active_pickup_role_grants(
            dry_run=dry_run,
            reason='pickup_role_repair',
        )

        action = 'Would enqueue' if dry_run else 'Enqueued'
        self.stdout.write(self.style.SUCCESS(
            f'{action} {result["enqueued"]} pickup-role grant event(s); '
            f'{result["already_exists"]} already had grant events; '
            f'{result["missing_discord_id"]} active pickup order(s) have no linked Discord ID.'
        ))
