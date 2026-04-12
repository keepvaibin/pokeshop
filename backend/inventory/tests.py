from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from orders.models import Order

from .models import Item, RecurringTimeslot


class RecurringTimeslotApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_user = get_user_model().objects.create_user(
            email='settings-admin@example.com',
            password='password123',
            is_staff=True,
        )

    def test_admin_can_patch_existing_recurring_timeslot(self):
        self.client.force_authenticate(self.admin_user)
        timeslot = RecurringTimeslot.objects.create(
            day_of_week=1,
            start_time='10:00',
            end_time='12:00',
            location='Crown',
            max_bookings=4,
            is_active=True,
        )

        response = self.client.patch(
            f'/api/inventory/recurring-timeslots/{timeslot.id}/',
            {
                'day_of_week': 3,
                'start_time': '13:00',
                'end_time': '15:00',
                'location': 'Merrill Plaza',
                'max_bookings': 7,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        timeslot.refresh_from_db()
        self.assertEqual(timeslot.day_of_week, 3)
        self.assertEqual(str(timeslot.start_time), '13:00:00')
        self.assertEqual(str(timeslot.end_time), '15:00:00')
        self.assertEqual(timeslot.location, 'Merrill Plaza')
        self.assertEqual(timeslot.max_bookings, 7)

    def test_public_recurring_timeslots_count_active_orders_not_distinct_users(self):
        timeslot = RecurringTimeslot.objects.create(
            day_of_week=timezone.localdate().weekday(),
            start_time='14:00',
            end_time='16:00',
            location='Crown College Courtyard',
            max_bookings=6,
            is_active=True,
        )
        pickup_date = timeslot.next_pickup_date()
        user = get_user_model().objects.create_user(email='bookings@example.com', username='bookings-user')
        item = Item.objects.create(title='Booking Item', stock=10, max_per_user=0, price='5.00')

        Order.objects.create(
            user=user,
            item=item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=timeslot,
            pickup_date=pickup_date,
            discord_handle='bookings#1234',
            status='trade_review',
        )
        Order.objects.create(
            user=user,
            item=item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=timeslot,
            pickup_date=pickup_date,
            discord_handle='bookings#1234',
            status='cash_needed',
        )
        Order.objects.create(
            user=user,
            item=item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=timeslot,
            pickup_date=pickup_date,
            discord_handle='bookings#1234',
            status='fulfilled',
        )

        response = self.client.get('/api/inventory/recurring-timeslots/')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
        self.assertEqual(results[0]['pickup_date'], pickup_date.isoformat())
        self.assertEqual(results[0]['bookings_this_week'], 2)
