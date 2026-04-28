import json
from decimal import Decimal
from datetime import datetime, timedelta, time as dt_time
from zoneinfo import ZoneInfo

from unittest.mock import Mock, patch

from django.contrib.admin.sites import AdminSite
from django.contrib.messages.storage.fallback import FallbackStorage
from django.db import DatabaseError
from django.db import connection
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework import status
from inventory.models import Item, PickupSlot, PokeshopSettings, PickupTimeslot, RecurringTimeslot, TCGCardPrice
from orders.admin import SupportTicketAdmin
from orders.models import CartItem, Order, OrderItem, SupportTicket, TradeCardItem
from orders.services import PROCESSING_BLUE, build_order_status_dm
from trade_ins.models import CreditLedger
from users.models import BotAPIKey, UserProfile

User = get_user_model()

PACIFIC_TZ = ZoneInfo('America/Los_Angeles')
UTC_TZ = ZoneInfo('UTC')


def _utc_from_pacific(year, month, day, hour, minute=0, second=0):
    return datetime(year, month, day, hour, minute, second, tzinfo=PACIFIC_TZ).astimezone(UTC_TZ)


def _utc_on_pacific_date(day, hour, minute=0, second=0):
    return datetime.combine(day, dt_time(hour, minute, second), tzinfo=PACIFIC_TZ).astimezone(UTC_TZ)


class CheckoutTestCase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='test@ucsc.edu')
        self.item = Item.objects.create(title='Test Item', stock=10, max_per_user=5)
        self.client.force_authenticate(user=self.user)

    def test_checkout_applies_store_credit_balance(self):
        UserProfile.objects.create(user=self.user, trade_credit_balance=Decimal('15.00'))
        self.item.price = Decimal('10.00')
        self.item.save(update_fields=['price'])

        response = self.client.post('/api/orders/checkout/', {
            'item_id': self.item.id,
            'quantity': 1,
            'payment_method': 'store_credit',
            'delivery_method': 'asap',
            'discord_handle': 'test#1234',
            'use_store_credit': True,
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(user=self.user)
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(order.payment_method, 'store_credit')
        self.assertEqual(order.store_credit_applied, Decimal('10.00'))
        self.assertEqual(profile.trade_credit_balance, Decimal('5.00'))
        self.assertTrue(CreditLedger.objects.filter(
            user=self.user,
            amount=Decimal('-10.00'),
            transaction_type=CreditLedger.TYPE_ORDER_PURCHASE,
            reference_id=f'order:{order.order_id}',
        ).exists())

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
        future_pickup = timezone.localdate() + timedelta(days=7)
        slot = RecurringTimeslot.objects.create(
            day_of_week=future_pickup.weekday(),
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
            pickup_date=future_pickup,
            discord_handle='other#1234',
            status='fulfilled',
        )

        response = self.client.post('/api/orders/checkout/', {
            'item_id': self.item.id,
            'quantity': 1,
            'payment_method': 'venmo',
            'delivery_method': 'scheduled',
            'recurring_timeslot_id': slot.id,
            'pickup_date': future_pickup.isoformat(),
            'discord_handle': 'test#1234',
        })

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_checkout_blocks_active_balance_due_orders_from_overbooking_slot(self):
        future_pickup = timezone.localdate() + timedelta(days=7)
        slot = RecurringTimeslot.objects.create(
            day_of_week=future_pickup.weekday(),
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
            pickup_date=future_pickup,
            discord_handle='other#1234',
            status='cash_needed',
        )

        response = self.client.post('/api/orders/checkout/', {
            'item_id': self.item.id,
            'quantity': 1,
            'payment_method': 'venmo',
            'delivery_method': 'scheduled',
            'recurring_timeslot_id': slot.id,
            'pickup_date': future_pickup.isoformat(),
            'discord_handle': 'test#1234',
        })

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'This timeslot is fully booked for the selected date')

    def test_checkout_allows_tomorrow_recurring_pickup_before_pacific_cutoff(self):
        tomorrow = datetime(2026, 4, 28).date()
        slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='14:00',
            end_time='16:00',
            max_bookings=2,
            is_active=True,
        )

        with patch('orders.views.timezone.now', return_value=_utc_from_pacific(2026, 4, 27, 20, 59)):
            response = self.client.post('/api/orders/checkout/', {
                'item_id': self.item.id,
                'quantity': 1,
                'payment_method': 'venmo',
                'delivery_method': 'scheduled',
                'recurring_timeslot_id': slot.id,
                'pickup_date': tomorrow.isoformat(),
                'discord_handle': 'test#1234',
            })

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(user=self.user)
        self.assertEqual(order.pickup_date, tomorrow)

    def test_checkout_rejects_tomorrow_recurring_pickup_after_pacific_cutoff(self):
        tomorrow = datetime(2026, 4, 28).date()
        slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='14:00',
            end_time='16:00',
            max_bookings=2,
            is_active=True,
        )

        with patch('orders.views.timezone.now', return_value=_utc_from_pacific(2026, 4, 27, 21, 1)):
            response = self.client.post('/api/orders/checkout/', {
                'item_id': self.item.id,
                'quantity': 1,
                'payment_method': 'venmo',
                'delivery_method': 'scheduled',
                'recurring_timeslot_id': slot.id,
                'pickup_date': tomorrow.isoformat(),
                'discord_handle': 'test#1234',
            })

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Scheduled pickup must be booked before 9 PM Pacific the day before pickup.')
        self.assertFalse(Order.objects.filter(user=self.user).exists())

    def test_checkout_rejects_same_day_one_off_timeslot_after_pacific_cutoff(self):
        pickup_day = datetime(2026, 4, 28).date()
        pickup_start = _utc_from_pacific(2026, 4, 28, 14, 0)
        pickup_timeslot = PickupTimeslot.objects.create(
            start=pickup_start,
            end=_utc_from_pacific(2026, 4, 28, 16, 0),
            max_bookings=2,
            is_active=True,
        )

        with patch('orders.views.timezone.now', return_value=_utc_from_pacific(2026, 4, 28, 10, 9)):
            response = self.client.post('/api/orders/checkout/', {
                'item_id': self.item.id,
                'quantity': 1,
                'payment_method': 'venmo',
                'delivery_method': 'scheduled',
                'pickup_timeslot_id': pickup_timeslot.id,
                'discord_handle': 'test#1234',
            })

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Scheduled pickup must be booked before 9 PM Pacific the day before pickup.')
        self.assertFalse(Order.objects.filter(user=self.user, pickup_timeslot=pickup_timeslot).exists())
        self.assertEqual(pickup_day, timezone.localtime(pickup_start, PACIFIC_TZ).date())

    def test_checkout_rejects_same_day_recurring_pickup(self):
        today = timezone.localdate()
        slot = RecurringTimeslot.objects.create(
            day_of_week=today.weekday(),
            start_time='14:00',
            end_time='16:00',
            max_bookings=2,
            is_active=True,
        )

        response = self.client.post('/api/orders/checkout/', {
            'item_id': self.item.id,
            'quantity': 1,
            'payment_method': 'venmo',
            'delivery_method': 'scheduled',
            'recurring_timeslot_id': slot.id,
            'pickup_date': today.isoformat(),
            'discord_handle': 'test#1234',
        })

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Scheduled pickup must be booked before 9 PM Pacific the day before pickup.')

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
                    'image_url': 'https://images.example.com/charizard.png',
                    'tcgplayer_url': 'https://www.tcgplayer.com/product/111',
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
        trade_card = TradeCardItem.objects.get(card_name='Charizard ex')
        self.assertEqual(trade_card.image_url, 'https://images.example.com/charizard.png')
        self.assertEqual(trade_card.tcgplayer_url, 'https://www.tcgplayer.com/product/111')
        self.assertLessEqual(len(tcg_queries), 1)

    def test_checkout_trade_card_oracle_lookup_falls_back_by_product_id(self):
        TCGCardPrice.objects.create(
            product_id=333,
            name='Mega Meganium ex',
            clean_name='Mega Meganium ex',
            group_id=24541,
            group_name='ME: Ascended Heroes',
            sub_type_name='Holofoil',
            market_price='12.00',
            tcgplayer_url='https://www.tcgplayer.com/product/333/pokemon-me-ascended-heroes-mega-meganium-ex',
        )

        response = self.client.post('/api/orders/checkout/', {
            'item_id': self.item.id,
            'quantity': 1,
            'payment_method': 'cash_plus_trade',
            'delivery_method': 'asap',
            'discord_handle': 'test#1234',
            'trade_mode': 'allow_partial',
            'trade_offer_data': [
                {
                    'card_name': 'Mega Meganium ex',
                    'estimated_value': '1.00',
                    'condition': 'near_mint',
                    'rarity': 'Double Rare',
                    'tcg_product_id': 333,
                    'tcg_sub_type': 'Stage 1, MEGA, ex',
                },
            ],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        trade_card = TradeCardItem.objects.get(card_name='Mega Meganium ex')
        self.assertEqual(trade_card.base_market_price, Decimal('12.00'))
        self.assertEqual(trade_card.tcg_sub_type, 'Holofoil')
        self.assertEqual(trade_card.tcgplayer_url, 'https://www.tcgplayer.com/product/333/pokemon-me-ascended-heroes-mega-meganium-ex')


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

        frozen_now = timezone.make_aware(datetime(2026, 4, 12, 21, 5, 0))
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

    def test_heartbeat_dispatch_prep_includes_tomorrow_packing_list(self):
        settings_obj = PokeshopSettings.load()
        settings_obj.discord_webhook_url = 'https://discord.com/api/webhooks/123/token'
        settings_obj.last_discord_eod_summary_on = None
        settings_obj.save(update_fields=['discord_webhook_url', 'last_discord_eod_summary_on'])

        frozen_now = timezone.make_aware(datetime(2026, 4, 12, 21, 5, 0))
        tomorrow = timezone.localdate(frozen_now) + timedelta(days=1)
        slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='14:00',
            end_time='16:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=2,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=slot,
            pickup_date=tomorrow,
            discord_handle='HeartbeatUser',
            status='pending',
        )

        with patch('orders.services._heartbeat_now', return_value=frozen_now):
            response = self.client.post(
                '/api/orders/discord-heartbeat/',
                {},
                format='json',
                HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        payload = response.data['actions'][0]['payload']
        embed = payload['embeds'][0]
        self.assertEqual(embed['title'], 'Dispatch Prep • Apr 13')
        fields = {field['name']: field['value'] for field in embed['fields']}
        self.assertIn('Tomorrow Packing List', fields)
        self.assertIn('- Heartbeat Item x2', fields['Tomorrow Packing List'])


class AdminCancelOrderViewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='admin-cancel@example.com', username='admin-cancel', is_admin=True)
        self.user = User.objects.create_user(email='cancel-customer@example.com', username='cancel-customer')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='101010101010101010',
            discord_handle='CancelUser',
            trade_credit_balance='10.00',
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

    def test_admin_cancel_restocks_order(self):
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
        # Order cancellation does NOT refund to wallet — trade-ins are the only
        # path to wallet credit; cancellation just frees stock & timeslots.
        self.assertEqual(self.profile.trade_credit_balance, Decimal('10.00'))

    def test_admin_cancel_refunds_applied_store_credit(self):
        self.order.store_credit_applied = Decimal('6.00')
        self.order.save(update_fields=['store_credit_applied'])
        self.profile.trade_credit_balance = Decimal('0.00')
        self.profile.save(update_fields=['trade_credit_balance'])

        self.client.force_authenticate(user=self.admin)

        response = self.client.post(
            f'/api/orders/{self.order.order_id}/cancel/',
            {'reason': 'Refunding store credit after cancellation.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.trade_credit_balance, Decimal('6.00'))
        self.assertTrue(CreditLedger.objects.filter(
            user=self.user,
            amount=Decimal('6.00'),
            transaction_type=CreditLedger.TYPE_ORDER_REFUND,
            reference_id=f'order:{self.order.order_id}',
        ).exists())

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


class AdminCancelOrderItemsViewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='admin-cancel-items@example.com', username='admin-cancel-items', is_admin=True)
        self.user = User.objects.create_user(email='cancel-items@example.com', username='cancel-items')
        self.profile = UserProfile.objects.create(
            user=self.user,
            discord_id='202020202020202020',
            discord_handle='CancelItemsUser',
            trade_credit_balance='0.00',
        )
        self.item_a = Item.objects.create(title='Primary Cancel Item', stock=2, max_per_user=0, price='12.00')
        self.item_b = Item.objects.create(title='Secondary Cancel Item', stock=1, max_per_user=0, price='8.00')
        self.order = Order.objects.create(
            user=self.user,
            payment_method='store_credit',
            delivery_method='asap',
            discord_handle='CancelItemsUser',
            status='pending',
            store_credit_applied='10.00',
        )
        self.order_line_a = OrderItem.objects.create(order=self.order, item=self.item_a, quantity=1, price_at_purchase='12.00')
        self.order_line_b = OrderItem.objects.create(order=self.order, item=self.item_b, quantity=1, price_at_purchase='8.00')

    def test_admin_can_cancel_specific_items_and_refund_excess_store_credit(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.post(
            f'/api/orders/{self.order.order_id}/cancel-items/',
            {
                'order_item_ids': [self.order_line_a.id],
                'reason': 'Pricing issue on this line item.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.profile.refresh_from_db()

        self.assertEqual(self.order.status, 'pending')
        self.assertEqual(self.order.store_credit_applied, Decimal('8.00'))
        self.assertEqual(self.order.order_items.count(), 1)
        self.assertEqual(self.order.order_items.first().item_id, self.item_b.id)
        self.assertEqual(self.item_a.stock, 3)
        self.assertEqual(self.item_b.stock, 1)
        self.assertEqual(self.profile.trade_credit_balance, Decimal('2.00'))
        self.assertTrue(CreditLedger.objects.filter(
            user=self.user,
            amount=Decimal('2.00'),
            transaction_type=CreditLedger.TYPE_ORDER_REFUND,
            reference_id=f'order:{self.order.order_id}',
        ).exists())

    def test_admin_item_cancel_recalculates_trade_balance(self):
        trade_item_keep = Item.objects.create(title='Trade Keep Item', stock=1, max_per_user=0, price='6.00')
        trade_item_remove = Item.objects.create(title='Trade Remove Item', stock=1, max_per_user=0, price='8.00')
        trade_order = Order.objects.create(
            user=self.user,
            payment_method='cash_plus_trade',
            delivery_method='asap',
            discord_handle='CancelItemsUser',
            status='cash_needed',
            trade_card_name='Trade Card',
            trade_card_value='10.00',
            trade_credit_applied='10.00',
        )
        OrderItem.objects.create(order=trade_order, item=trade_item_keep, quantity=1, price_at_purchase='6.00')
        removable_line = OrderItem.objects.create(order=trade_order, item=trade_item_remove, quantity=1, price_at_purchase='8.00')

        self.client.force_authenticate(user=self.admin)

        response = self.client.post(
            f'/api/orders/{trade_order.order_id}/cancel-items/',
            {
                'order_item_ids': [removable_line.id],
                'reason': 'The listed price was wrong for this item.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        trade_order.refresh_from_db()
        trade_item_remove.refresh_from_db()

        self.assertEqual(trade_order.status, 'pending')
        self.assertEqual(trade_order.payment_method, 'trade')
        self.assertEqual(trade_order.trade_credit_applied, Decimal('6.00'))
        self.assertEqual(trade_order.trade_overage, Decimal('4.00'))
        self.assertEqual(trade_order.order_items.count(), 1)
        self.assertEqual(trade_item_remove.stock, 2)

    def test_cancelling_every_item_uses_full_order_cancel(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.post(
            f'/api/orders/{self.order.order_id}/cancel-items/',
            {
                'order_item_ids': [self.order_line_a.id, self.order_line_b.id],
                'reason': 'Cancelling all line items after review.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.profile.refresh_from_db()

        self.assertEqual(self.order.status, 'cancelled')
        self.assertEqual(self.order.cancelled_by_id, self.admin.id)
        self.assertEqual(self.order.cancellation_reason, 'Cancelling all line items after review.')
        self.assertEqual(self.profile.trade_credit_balance, Decimal('10.00'))

    def test_non_admin_cannot_cancel_items(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            f'/api/orders/{self.order.order_id}/cancel-items/',
            {
                'order_item_ids': [self.order_line_a.id],
                'reason': 'Should not be allowed.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class MergeCartIntoOrderViewTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='merge-cart@example.com', username='merge-cart-user')
        self.client.force_authenticate(user=self.user)
        self.existing_item = Item.objects.create(title='Existing Merge Item', stock=3, max_per_user=0, price='12.00')
        self.cart_item = Item.objects.create(title='Cart Merge Item', stock=5, max_per_user=0, price='7.00')

    def test_scheduled_order_for_tomorrow_can_be_merged_even_if_order_is_older(self):
        tomorrow = timezone.localdate() + timedelta(days=1)
        slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='14:00',
            end_time='16:00',
            max_bookings=4,
            is_active=True,
            location='Campus',
        )
        order = Order.objects.create(
            user=self.user,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=slot,
            pickup_date=tomorrow,
            discord_handle='merge#1234',
            status='pending',
        )
        OrderItem.objects.create(order=order, item=self.existing_item, quantity=1, price_at_purchase='12.00')
        stale_time = timezone.now() - timedelta(days=5)
        Order.objects.filter(pk=order.pk).update(created_at=stale_time, updated_at=stale_time)
        CartItem.objects.create(user=self.user, item=self.cart_item, quantity=2)

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(tomorrow - timedelta(days=1), 20, 59)):
            response = self.client.post(f'/api/orders/{order.order_id}/merge-cart/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.cart_item.refresh_from_db()
        self.assertEqual(order.order_items.count(), 2)
        self.assertFalse(CartItem.objects.filter(user=self.user).exists())
        self.assertEqual(self.cart_item.stock, 3)

    def test_stale_asap_order_can_no_longer_be_merged(self):
        order = Order.objects.create(
            user=self.user,
            payment_method='venmo',
            delivery_method='asap',
            discord_handle='merge#1234',
            status='pending',
        )
        OrderItem.objects.create(order=order, item=self.existing_item, quantity=1, price_at_purchase='12.00')
        stale_time = timezone.now() - timedelta(days=2)
        Order.objects.filter(pk=order.pk).update(created_at=stale_time, updated_at=stale_time)
        CartItem.objects.create(user=self.user, item=self.cart_item, quantity=1)

        response = self.client.post(f'/api/orders/{order.order_id}/merge-cart/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'This order is too old to merge into (older than 1 day).')


class RescheduleOrderViewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='admin-reschedule@example.com', username='admin-reschedule', is_admin=True)
        self.admin_profile = UserProfile.objects.create(
            user=self.admin,
            discord_id='998877665544332211',
            discord_handle='RescheduleAdmin',
        )
        self.user = User.objects.create_user(email='reschedule@example.com', username='reschedule-user')
        self.client.force_authenticate(user=self.user)
        self.item = Item.objects.create(title='Reschedule Product', stock=3, max_per_user=0, price='10.00')

    def test_customer_can_reschedule_once_to_tomorrow_and_admin_is_notified(self):
        current_pickup = timezone.localdate() + timedelta(days=2)
        tomorrow = timezone.localdate() + timedelta(days=1)
        current_slot = RecurringTimeslot.objects.create(
            day_of_week=current_pickup.weekday(),
            start_time='15:00',
            end_time='16:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        new_slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='12:00',
            end_time='13:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=current_slot,
            pickup_date=current_pickup,
            discord_handle='buyer#1234',
            status='pending',
        )

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(tomorrow - timedelta(days=1), 20, 59)), \
            patch('orders.services.notify_order_rescheduled') as notify_order_rescheduled:
            response = self.client.post(
                '/api/orders/reschedule/',
                {
                    'order_id': order.id,
                    'recurring_timeslot_id': new_slot.id,
                    'pickup_date': tomorrow.isoformat(),
                },
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.recurring_timeslot_id, new_slot.id)
        self.assertEqual(order.pickup_date, tomorrow)
        self.assertTrue(order.pickup_rescheduled_by_user)
        self.assertEqual(order.resolution_summary[-1]['event'], 'pickup_rescheduled')
        notify_order_rescheduled.assert_called_once()

    def test_customer_cannot_voluntarily_reschedule_same_day(self):
        today = timezone.localdate()
        tomorrow = today + timedelta(days=1)
        current_slot = RecurringTimeslot.objects.create(
            day_of_week=today.weekday(),
            start_time='15:00',
            end_time='16:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        new_slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='12:00',
            end_time='13:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=current_slot,
            pickup_date=today,
            discord_handle='buyer#1234',
            status='pending',
        )

        response = self.client.post(
            '/api/orders/reschedule/',
            {
                'order_id': order.id,
                'recurring_timeslot_id': new_slot.id,
                'pickup_date': tomorrow.isoformat(),
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Pickup day can only be changed until the day before your current pickup.')

    def test_admin_can_reschedule_legacy_pickup_timeslot_order(self):
        today = timezone.localdate()
        tomorrow = today + timedelta(days=1)
        legacy_start = timezone.make_aware(datetime.combine(today, datetime.strptime('15:00', '%H:%M').time()))
        legacy_end = timezone.make_aware(datetime.combine(today, datetime.strptime('16:00', '%H:%M').time()))
        legacy_timeslot = PickupTimeslot.objects.create(
            start=legacy_start,
            end=legacy_end,
            is_active=True,
            max_bookings=3,
        )
        new_slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='12:00',
            end_time='13:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            pickup_timeslot=legacy_timeslot,
            discord_handle='buyer#1234',
            status='pending',
        )
        self.client.force_authenticate(user=self.admin)

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(tomorrow - timedelta(days=1), 20, 59)):
            response = self.client.post(
                '/api/orders/reschedule/',
                {
                    'order_id': order.id,
                    'recurring_timeslot_id': new_slot.id,
                    'pickup_date': tomorrow.isoformat(),
                    'admin': True,
                },
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        legacy_timeslot.refresh_from_db()
        self.assertEqual(order.recurring_timeslot_id, new_slot.id)
        self.assertEqual(order.pickup_date, tomorrow)
        self.assertIsNone(order.pickup_timeslot_id)
        self.assertFalse(order.pickup_rescheduled_by_user)
        self.assertEqual(order.resolution_summary[-1]['event'], 'pickup_rescheduled')
        self.assertEqual(legacy_timeslot.current_bookings, 0)

    def test_admin_can_reschedule_same_day_legacy_order(self):
        today = timezone.localdate()
        tomorrow = today + timedelta(days=1)
        legacy_slot = PickupSlot.objects.create(
            date_time=timezone.make_aware(datetime.combine(today, datetime.strptime('15:00', '%H:%M').time())),
            is_claimed=True,
        )
        new_slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='12:00',
            end_time='13:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            pickup_slot=legacy_slot,
            discord_handle='buyer#1234',
            status='pending',
        )
        self.client.force_authenticate(user=self.admin)

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(tomorrow - timedelta(days=1), 20, 59)):
            response = self.client.post(
                '/api/orders/reschedule/',
                {
                    'order_id': order.id,
                    'recurring_timeslot_id': new_slot.id,
                    'pickup_date': tomorrow.isoformat(),
                    'admin': True,
                },
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        legacy_slot.refresh_from_db()
        self.assertEqual(order.recurring_timeslot_id, new_slot.id)
        self.assertEqual(order.pickup_date, tomorrow)
        self.assertIsNone(order.pickup_slot_id)
        self.assertFalse(legacy_slot.is_claimed)

    def test_invalid_new_pickup_date_returns_400_instead_of_500(self):
        today = timezone.localdate()
        tomorrow = today + timedelta(days=1)
        current_slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='15:00',
            end_time='16:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        new_slot = RecurringTimeslot.objects.create(
            day_of_week=today.weekday(),
            start_time='12:00',
            end_time='13:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            recurring_timeslot=current_slot,
            pickup_date=tomorrow,
            discord_handle='buyer#1234',
            status='pending',
        )

        response = self.client.post(
            '/api/orders/reschedule/',
            {
                'order_id': order.id,
                'recurring_timeslot_id': new_slot.id,
                'pickup_date': today.isoformat(),
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Scheduled pickup must be booked before 9 PM Pacific the day before pickup.')

    def test_database_errors_return_json_instead_of_raw_500(self):
        today = timezone.localdate()
        tomorrow = today + timedelta(days=1)
        new_slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='12:00',
            end_time='13:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='scheduled',
            discord_handle='buyer#1234',
            status='pending',
        )
        self.client.force_authenticate(user=self.admin)

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(tomorrow - timedelta(days=1), 20, 59)), \
            patch('orders.views.Order.objects.select_for_update') as mock_select_for_update:
            mock_select_for_update.return_value.get.side_effect = DatabaseError(
                'FOR UPDATE cannot be applied to the nullable side of an outer join'
            )

            response = self.client.post(
                '/api/orders/reschedule/',
                {
                    'order_id': order.id,
                    'recurring_timeslot_id': new_slot.id,
                    'pickup_date': tomorrow.isoformat(),
                    'admin': True,
                },
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data['error'], 'Unable to reschedule order right now.')


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
