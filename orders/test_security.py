import json

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from inventory.models import Item
from orders.models import SupportTicket, TradeCardItem
from users.models import BotAPIKey, UserProfile


User = get_user_model()


class CheckoutSecurityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='checkout-security@example.com')
        self.item = Item.objects.create(title='Security Item', stock=4, max_per_user=0, price='12.00')
        self.client.force_authenticate(user=self.user)

    def test_trade_card_inputs_are_sanitized_before_save(self):
        response = self.client.post(
            '/api/orders/checkout/',
            {
                'item_id': self.item.id,
                'quantity': 1,
                'payment_method': 'trade',
                'delivery_method': 'asap',
                'trade_offer_data': [
                    {
                        'card_name': '<b>Charizard ex</b>',
                        'estimated_value': '15.00',
                        'condition': 'near_mint',
                        'tcg_sub_type': '<script>Reverse Holofoil</script>',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        trade_card = TradeCardItem.objects.get()
        self.assertEqual(trade_card.card_name, 'Charizard ex')
        self.assertEqual(trade_card.tcg_sub_type, 'Reverse Holofoil')


class SupportTicketSecurityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='support-security@example.com')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='123456789012345678',
            discord_handle='SlugFan',
        )
        self.bot_api_key = BotAPIKey(name='Security Bot')
        self.raw_key = BotAPIKey.generate_key()
        self.bot_api_key.set_key(self.raw_key)
        self.bot_api_key.save()

    def test_support_ticket_rejects_invalid_discord_ids(self):
        response = self.client.post(
            '/api/orders/support-tickets/',
            {
                'discord_id': 'not-a-snowflake',
                'category': 'Bug/Other',
            },
            format='json',
            HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('discord_id', response.data)

    def test_support_ticket_sanitizes_text_and_metadata(self):
        response = self.client.post(
            '/api/orders/support-tickets/',
            {
                'discord_id': self.profile.discord_id,
                'category': '<b>Trade-in Inquiry</b>',
                'message': '<b>Need help</b>\n<script>alert(1)</script>',
                'metadata': {
                    'source': 'ticket <b>modal</b>',
                    'notes': ['<i>urgent</i>'],
                },
            },
            format='json',
            HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        ticket = SupportTicket.objects.get(discord_user_id=self.profile.discord_id)
        self.assertEqual(ticket.subject, 'Trade-in Inquiry')
        self.assertNotIn('<', ticket.initial_message)
        self.assertEqual(ticket.metadata['source'], 'ticket modal')
        self.assertEqual(ticket.metadata['notes'][0], 'urgent')