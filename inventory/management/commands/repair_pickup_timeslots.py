from django.core.management.base import BaseCommand
from django.db import transaction

from inventory.pickup_repair import repair_customer_pickup_timeslots


class Command(BaseCommand):
    help = 'Repair invalid recurring pickup templates and seed safe defaults if none are usable.'

    def handle(self, *args, **options):
        with transaction.atomic():
            summary = repair_customer_pickup_timeslots()

        self.stdout.write(self.style.SUCCESS(
            'Recurring pickup repair complete: '
            f"{len(summary['repaired'])} repaired, "
            f"{len(summary['deactivated'])} deactivated, "
            f"{len(summary['seeded'])} seeded."
        ))
