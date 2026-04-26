import json
from decimal import Decimal
from datetime import datetime, timedelta

from unittest.mock import Mock, patch

from django.contrib.admin.sites import AdminSite
from django.contrib.messages.storage.fallback import FallbackStorage
from django.db import connection
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework import status
from inventory.models import Item, PokeshopSettings, PickupTimeslot, RecurringTimeslot, TCGCardPrice
from orders.admin import SupportTicketAdmin
from orders.models import Order, OrderItem, SupportTicket
from orders.services import PROCESSING_BLUE, build_order_status_dm
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

    def test_checkout_ignores_fulfilled_orders_for_recurring_slot_capacity(self):
        slot = RecurringTimeslot.objects.create(
            day_of_week=timezone.localdate().weekday(),
            start_time='14:00',
            end_time='16:00',
            max_bookings=1,
            is_active=True,
        )
        other_user = User.objects.create_user(email='fulfilled-slot@example.com', username='fulfilled-slot')
        Order.objects.create(
            user=other_user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=slot,
            pickup_date=slot.next_pickup_date(),
            discord_handle='other#1234',
            status='fulfilled',
        )

        response = self.client.post('/api/orders/checkout/', {
            'item_id': self.item.id,
            'quantity': 1,
            'payment_method': 'venmo',
            'delivery_method': 'scheduled',
            'recurring_timeslot_id': slot.id,
            'pickup_date': slot.next_pickup_date().isoformat(),
            'discord_handle': 'test#1234',
        })

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_checkout_blocks_active_balance_due_orders_from_overbooking_slot(self):
        slot = RecurringTimeslot.objects.create(
            day_of_week=timezone.localdate().weekday(),
            start_time='14:00',
            end_time='16:00',
            max_bookings=1,
            is_active=True,
        )
        other_user = User.objects.create_user(email='active-slot@example.com', username='active-slot')
        Order.objects.create(
            user=other_user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=slot,
            pickup_date=slot.next_pickup_date(),
            discord_handle='other#1234',
            status='cash_needed',
        )

        response = self.client.post('/api/orders/checkout/', {
            'item_id': self.item.id,
            'quantity': 1,
            'payment_method': 'venmo',
            'delivery_method': 'scheduled',
            'recurring_timeslot_id': slot.id,
            'pickup_date': slot.next_pickup_date().isoformat(),
            'discord_handle': 'test#1234',
        })

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'This timeslot is fully booked for the selected date')

    def test_checkout_batches_tcg_oracle_lookups_for_multi_card_trade(self):
        TCGCardPrice.objects.create(
            product_id=111,
            name='Charizard ex',
            clean_name='charizard ex',
            group_id=1,
            group_name='Test Group',
            sub_type_name='Normal',
            market_price='10.00',
        )
        TCGCardPrice.objects.create(
            product_id=222,
            name='Blastoise ex',
            clean_name='blastoise ex',
            group_id=2,
            group_name='Test Group',
            sub_type_name='Holofoil',
            market_price='20.00',
        )

        payload = {
            'item_id': self.item.id,
            'quantity': 1,
            'payment_method': 'cash_plus_trade',
            'delivery_method': 'asap',
            'discord_handle': 'test#1234',
            'trade_mode': 'allow_partial',
            'trade_offer_data': [
                {
                    'card_name': 'Charizard ex',
                    'estimated_value': '10.00',
                    'condition': 'near_mint',
                    'rarity': 'rare',
                    'tcg_product_id': 111,
                    'tcg_sub_type': 'Normal',
                },
                {
                    'card_name': 'Blastoise ex',
                    'estimated_value': '20.00',
                    'condition': 'lightly_played',
                    'rarity': 'rare',
                    'tcg_product_id': 222,
                    'tcg_sub_type': 'Holofoil',
                },
            ],
        }

        with CaptureQueriesContext(connection) as queries:
            response = self.client.post('/api/orders/checkout/', payload, format='json')

        tcg_queries = [
            query for query in queries.captured_queries
            if 'inventory_tcgcardprice' in query['sql'].lower() and 'select' in query['sql'].lower()
        ]

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertLessEqual(len(tcg_queries), 1)


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


class OverdueOrdersViewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='overdue-admin@example.com', username='overdue-admin', is_admin=True)
        self.user = User.objects.create_user(email='overdue-user@example.com', username='overdue-user')
        self.item = Item.objects.create(title='Overdue Item', stock=10, max_per_user=0, price='9.99')

    def test_admin_gets_only_overdue_scheduled_active_orders(self):
        yesterday = timezone.localdate() - timedelta(days=1)
        today = timezone.localdate()

        Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            pickup_date=yesterday,
            discord_handle='overdue#1234',
            status='pending',
        )
        Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            pickup_date=today,
            discord_handle='today#1234',
            status='pending',
        )

        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/orders/overdue/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get('results', response.data)
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]['discord_handle'], 'overdue#1234')

    def test_admin_gets_overdue_timeslot_orders_without_pickup_date(self):
        past_start = timezone.now() - timedelta(hours=3)
        slot = PickupTimeslot.objects.create(start=past_start, end=past_start + timedelta(hours=1), is_active=True)
        Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            pickup_timeslot=slot,
            discord_handle='slot#1234',
            status='pending',
        )

        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/orders/overdue/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get('results', response.data)
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]['discord_handle'], 'slot#1234')

    def test_non_admin_gets_empty_overdue_list(self):
        yesterday = timezone.localdate() - timedelta(days=1)
        Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            pickup_date=yesterday,
            discord_handle='overdue#1234',
            status='pending',
        )

        self.client.force_authenticate(self.user)
        response = self.client.get('/api/orders/overdue/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get('results', response.data)
        self.assertEqual(payload, [])


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

    def test_bot_can_create_ticket_with_phase_two_payload_shape(self):
        response = self.client.post(
            '/api/orders/support-tickets/',
            {
                'discord_id': self.profile.discord_id,
                'category': 'Trade-in Inquiry',
                'message': 'Can you review my trade before meetup?',
                'metadata': {'source': 'ticket-modal'},
            },
            format='json',
            HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        ticket = SupportTicket.objects.get(subject='Trade-in Inquiry')
        self.assertEqual(ticket.user, self.user)
        self.assertEqual(ticket.initial_message, 'Can you review my trade before meetup?')
        self.assertEqual(ticket.metadata['source'], 'ticket-modal')
        self.assertTrue(ticket.discord_channel_id)


class OrderNotificationSignalTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='dispatch-admin@example.com', username='dispatch-admin', is_admin=True)
        self.admin_profile = UserProfile.objects.create(
            user=self.admin,
            discord_id='998877665544332211',
            discord_handle='DispatchAdmin',
        )
        self.user = User.objects.create_user(email='signals@example.com', username='signals-user')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='223344556677889900',
            discord_handle='SignalUser',
        )
        self.item = Item.objects.create(title='Signal Item', stock=3, max_per_user=0)

    @patch('orders.signals.notify_new_asap_order_to_admins')
    @patch('orders.signals.notify_order_status_via_dm')
    def test_new_order_triggers_dm(self, mock_dm, mock_admin_alert):
        with self.captureOnCommitCallbacks(execute=True):
            order = Order.objects.create(
                user=self.user,
                item=self.item,
                quantity=1,
                payment_method='venmo',
                delivery_method='asap',
                discord_handle='SignalUser',
                status='pending',
            )

        mock_dm.assert_called_once_with(order)
        mock_admin_alert.assert_called_once_with(order)

    @patch('orders.signals.notify_new_asap_order_to_admins')
    @patch('orders.signals.notify_order_status_via_dm')
    def test_status_change_triggers_dm_without_extra_side_effects(self, mock_dm, mock_admin_alert):
        with self.captureOnCommitCallbacks(execute=True):
            order = Order.objects.create(
                user=self.user,
                item=self.item,
                quantity=1,
                payment_method='venmo',
                delivery_method='asap',
                discord_handle='SignalUser',
                status='pending',
            )
        mock_dm.reset_mock()
        mock_admin_alert.reset_mock()

        with self.captureOnCommitCallbacks(execute=True):
            order.status = 'pending_counteroffer'
            order.save(update_fields=['status'])

        mock_dm.assert_called_once_with(order)
        mock_admin_alert.assert_not_called()

    @patch('orders.signals.notify_new_asap_order_to_admins')
    def test_new_asap_order_triggers_admin_alert(self, mock_admin_alert):
        with self.captureOnCommitCallbacks(execute=True):
            order = Order.objects.create(
                user=self.user,
                item=self.item,
                quantity=1,
                payment_method='venmo',
                delivery_method='asap',
                discord_handle='SignalUser',
                status='pending',
            )

        mock_admin_alert.assert_called_once_with(order)


class OrderNotificationPayloadTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='payloads@example.com')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='554433221100998877',
            discord_handle='PayloadUser',
        )
        self.item = Item.objects.create(
            title='Premium Card Binder',
            stock=2,
            max_per_user=0,
            image_path='https://images.example.com/binder.png',
            price='25.00',
        )

    def test_cash_needed_dm_uses_neutral_premium_payload(self):
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='cash_plus_trade',
            delivery_method='asap',
            discord_handle='PayloadUser',
            status='cash_needed',
        )

        payload = build_order_status_dm(order)

        self.assertIsNotNone(payload)
        self.assertEqual(payload['title'], 'Order Update: Balance Due')
        self.assertEqual(payload['color'], PROCESSING_BLUE)
        self.assertEqual(payload['button']['label'], 'Review Balance')
        self.assertEqual(payload['thumbnail_url'], 'https://images.example.com/binder.png')
        self.assertTrue(any(field['name'] == 'Balance Due' for field in payload['fields']))

    def test_trade_rejection_cash_fallback_dm_mentions_declined_trade(self):
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='asap',
            discord_handle='PayloadUser',
            status='cash_needed',
            buy_if_trade_denied=True,
        )
        order._previous_status = 'trade_review'

        payload = build_order_status_dm(order)

        self.assertIsNotNone(payload)
        self.assertIn('reviewed and declined', payload['description'])
        self.assertIn('fall back to cash', payload['description'])
        self.assertIn('$25.00', payload['description'])


class DiscordHeartbeatApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='admin-heartbeat@example.com', username='admin-heartbeat', is_admin=True)
        self.admin_profile = UserProfile.objects.create(
            user=self.admin,
            discord_id='667788990011223344',
            discord_handle='HeartbeatAdmin',
        )
        self.user = User.objects.create_user(email='heartbeat@example.com', username='heartbeat-user')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='112233445566778899',
            discord_handle='HeartbeatUser',
        )
        self.item = Item.objects.create(title='Heartbeat Item', stock=5, max_per_user=0, price='19.99')
        self.bot_api_key = BotAPIKey(name='Heartbeat Bot')
        self.raw_key = BotAPIKey.generate_key()
        self.bot_api_key.set_key(self.raw_key)
        self.bot_api_key.save()

    def test_heartbeat_returns_due_asap_dm_and_advances_level(self):
        with patch('orders.signals.notify_new_asap_order_to_admins'):
            order = Order.objects.create(
                user=self.user,
                item=self.item,
                quantity=1,
                payment_method='venmo',
                delivery_method='asap',
                discord_handle='HeartbeatUser',
                status='pending',
            )
        stale_time = timezone.now() - timedelta(hours=20, minutes=5)
        Order.objects.filter(pk=order.pk).update(created_at=stale_time)

        response = self.client.post(
            '/api/orders/discord-heartbeat/',
            {},
            format='json',
            HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        action = response.data['actions'][0]
        self.assertEqual(action['type'], 'dm')
        self.assertEqual(action['discord_id'], self.admin_profile.discord_id)
        self.assertEqual(action['title'], 'ASAP Order Reminder')
        self.assertIn(f'<@{self.profile.discord_id}>', action['description'])
        order.refresh_from_db()
        self.assertEqual(order.asap_reminder_level, 2)
        self.bot_api_key.refresh_from_db()
        self.assertIsNotNone(self.bot_api_key.last_used_at)

    def test_heartbeat_ignores_acknowledged_asap_orders(self):
        with patch('orders.signals.notify_new_asap_order_to_admins'):
            order = Order.objects.create(
                user=self.user,
                item=self.item,
                quantity=1,
                payment_method='venmo',
                delivery_method='asap',
                discord_handle='HeartbeatUser',
                status='pending',
                is_acknowledged=True,
            )
        stale_time = timezone.now() - timedelta(hours=23, minutes=30)
        Order.objects.filter(pk=order.pk).update(created_at=stale_time)

        response = self.client.post(
            '/api/orders/discord-heartbeat/',
            {},
            format='json',
            HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)
        order.refresh_from_db()
        self.assertEqual(order.status, 'pending')
        self.assertEqual(order.asap_reminder_level, 0)

    def test_heartbeat_cancels_expired_unacknowledged_asap_orders(self):
        with patch('orders.signals.notify_new_asap_order_to_admins'):
            order = Order.objects.create(
                user=self.user,
                item=self.item,
                quantity=2,
                payment_method='venmo',
                delivery_method='asap',
                discord_handle='HeartbeatUser',
                status='pending',
            )
        self.item.stock = 3
        self.item.save(update_fields=['stock'])
        stale_time = timezone.now() - timedelta(hours=24, minutes=5)
        Order.objects.filter(pk=order.pk).update(created_at=stale_time)

        with patch('orders.signals.notify_order_status_via_dm'):
            response = self.client.post(
                '/api/orders/discord-heartbeat/',
                {},
                format='json',
                HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.item.refresh_from_db()
        self.assertEqual(order.status, 'cancelled')
        self.assertIsNotNone(order.cancelled_at)


    def test_heartbeat_returns_eod_webhook_once_per_day(self):
        settings_obj = PokeshopSettings.load()
        settings_obj.discord_webhook_url = 'https://discord.com/api/webhooks/123/token'
        settings_obj.last_discord_eod_summary_on = None
        settings_obj.save(update_fields=['discord_webhook_url', 'last_discord_eod_summary_on'])

        frozen_now = timezone.make_aware(datetime(2026, 4, 12, 20, 5, 0))
        with patch('orders.services._heartbeat_now', return_value=frozen_now):
            first_response = self.client.post(
                '/api/orders/discord-heartbeat/',
                {},
                format='json',
                HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
            )
            second_response = self.client.post(
                '/api/orders/discord-heartbeat/',
                {},
                format='json',
                HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
            )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(first_response.data['count'], 1)
        self.assertEqual(first_response.data['actions'][0]['type'], 'webhook')
        self.assertIn('embeds', first_response.data['actions'][0]['payload'])
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.data['count'], 0)
        settings_obj.refresh_from_db()
        self.assertEqual(str(settings_obj.last_discord_eod_summary_on), '2026-04-12')


class AdminCancelOrderViewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='admin-cancel@example.com', username='admin-cancel', is_admin=True)
        self.user = User.objects.create_user(email='cancel-customer@example.com', username='cancel-customer')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='101010101010101010',
            discord_handle='CancelUser',
            trade_credit='10.00',
        )
        self.item = Item.objects.create(title='Cancelable Product', stock=3, max_per_user=0, price='12.00')
        self.order = Order.objects.create(
            user=self.user,
            payment_method='cash_plus_trade',
            delivery_method='asap',
            discord_handle='CancelUser',
            status='pending',
            trade_credit_applied='4.00',
        )
        OrderItem.objects.create(order=self.order, item=self.item, quantity=2, price_at_purchase='12.00')

    def test_admin_cancel_restocks_and_refunds_trade_credit(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.post(
            f'/api/orders/{self.order.order_id}/cancel/',
            {'reason': 'Out-of-stock after quality check.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.item.refresh_from_db()
        self.profile.refresh_from_db()

        self.assertEqual(self.order.status, 'cancelled')
        self.assertIsNotNone(self.order.cancelled_at)
        self.assertEqual(self.order.cancellation_reason, 'Out-of-stock after quality check.')
        self.assertEqual(self.order.cancelled_by_id, self.admin.id)
        self.assertEqual(self.item.stock, 5)
        self.assertEqual(self.profile.trade_credit, Decimal('14.00'))

    def test_non_admin_cannot_cancel_by_uuid_endpoint(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            f'/api/orders/{self.order.order_id}/cancel/',
            {'reason': 'Should not be allowed'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock, 3)


class SupportTicketAdminTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.site = AdminSite()
        self.model_admin = SupportTicketAdmin(SupportTicket, self.site)
        self.staff_user = User.objects.create_superuser(email='admin@example.com', password='password123', username='admin-user')
        self.user = User.objects.create_user(email='ticket-owner@example.com', username='ticket-owner')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='123123123123123123',
            discord_handle='TicketOwner',
        )
        self.item = Item.objects.create(title='Admin Ticket Item', stock=1, max_per_user=0)
        self.order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='asap',
            discord_handle='TicketOwner',
            status='pending',
        )
        self.ticket = SupportTicket.objects.create(
            user=self.user,
            order=self.order,
            discord_user_id=self.profile.discord_id,
            discord_channel_id='admin-ticket-1',
            subject='Order/Meetup Issue',
            initial_message='Where should we meet?',
        )

    @patch('orders.admin.send_discord_dm', return_value=True)
    def test_admin_reply_closes_ticket_after_dm(self, mock_send_dm):
        request = self.factory.post('/admin/orders/supportticket/')
        request.user = self.staff_user
        request.session = {}
        setattr(request, '_messages', FallbackStorage(request))
        form = Mock(cleaned_data={'reply_message': 'Meet us at the pickup table at noon.'})

        self.model_admin.save_model(request, self.ticket, form, change=True)

        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, 'closed')
        self.assertIsNotNone(self.ticket.closed_at)
        mock_send_dm.assert_called_once()
