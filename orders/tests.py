from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from inventory.models import Item
from orders.models import Order, SupportTicket
from users.models import BotAPIKey, UserProfile

User = get_user_model()

class CheckoutTestCase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='test@ucsc.edu')
        self.item = Item.objects.create(title='Test Item', stock=10, max_per_user=5)
        self.client.force_authenticate(user=self.user)

    def test_successful_checkout(self):
        data = {
            'item_id': self.item.id,
            'quantity': 2,
            'payment_method': 'venmo',
            'delivery_method': 'asap',
            'discord_handle': 'test#1234'
        }
        response = self.client.post('/api/orders/checkout/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock, 8)
        self.assertTrue(Order.objects.filter(user=self.user, item=self.item).exists())

    def test_checkout_skips_daily_limit_when_max_per_user_is_zero(self):
        self.item.max_per_user = 0
        self.item.save(update_fields=['max_per_user'])
        Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=8,
            payment_method='venmo',
            delivery_method='asap',
            discord_handle='test#1234',
            status='fulfilled',
        )

        response = self.client.post('/api/orders/checkout/', {
            'item_id': self.item.id,
            'quantity': 2,
            'payment_method': 'venmo',
            'delivery_method': 'asap',
            'discord_handle': 'test#1234',
        })

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class PurchaseLimitsViewTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='limits@ucsc.edu')
        self.client.force_authenticate(user=self.user)

    def test_unlimited_items_return_null_remaining(self):
        item = Item.objects.create(title='Unlimited Item', stock=5, max_per_user=0)

        response = self.client.get('/api/orders/purchase-limits/', {'all': 1})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[str(item.id)]['max_per_user'], 0)
        self.assertIsNone(response.data[str(item.id)]['remaining'])


class SupportTicketApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='discord-user@example.com')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='123456789012345678',
            discord_handle='Slug Fan',
        )
        self.item = Item.objects.create(title='Ticketed Item', stock=5, max_per_user=0)
        self.order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='asap',
            discord_handle='Slug Fan',
            status='pending',
        )
        self.bot_api_key = BotAPIKey(name='Support Bot')
        self.raw_key = BotAPIKey.generate_key()
        self.bot_api_key.set_key(self.raw_key)
        self.bot_api_key.save()

    def test_bot_can_create_support_ticket_for_linked_discord_user(self):
        response = self.client.post(
            '/api/orders/support-tickets/',
            {
                'discord_user_id': self.profile.discord_id,
                'discord_channel_id': '998877665544332211',
                'subject': 'Pickup question',
                'initial_message': 'Where should I meet for pickup?',
                'order_id': str(self.order.order_id),
                'metadata': {'source': 'discord-bot'},
            },
            format='json',
            HTTP_X_BOT_API_KEY=self.raw_key,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        ticket = SupportTicket.objects.get(discord_channel_id='998877665544332211')
        self.assertEqual(ticket.user, self.user)
        self.assertEqual(ticket.order, self.order)
        self.assertEqual(ticket.subject, 'Pickup question')
        self.assertEqual(ticket.metadata['source'], 'discord-bot')
        self.bot_api_key.refresh_from_db()
        self.assertIsNotNone(self.bot_api_key.last_used_at)

    def test_missing_or_invalid_bot_key_is_rejected(self):
        response = self.client.post(
            '/api/orders/support-tickets/',
            {
                'discord_user_id': self.profile.discord_id,
                'discord_channel_id': '998877665544332211',
                'subject': 'Pickup question',
            },
            format='json',
            HTTP_X_BOT_API_KEY='invalid-key',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
