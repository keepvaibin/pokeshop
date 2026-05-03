import json
from decimal import Decimal
from datetime import date, datetime, timedelta, time as dt_time
from zoneinfo import ZoneInfo

from unittest.mock import AsyncMock, Mock, patch

from asgiref.sync import async_to_sync
from django.contrib.admin.sites import AdminSite
from django.contrib.messages.storage.fallback import FallbackStorage
from django.db import DatabaseError
from django.db import connection, transaction
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework import status
from inventory.models import Category, Item, PickupSlot, PokeshopSettings, PickupTimeslot, RecurringTimeslot, TCGCardPrice
from orders.admin import SupportTicketAdmin
from orders.discord_pickup_roles import configured_pickup_dates
from orders.models import CartItem, Coupon, DiscordPickupLifecycleRun, DiscordRoleEvent, Order, OrderItem, SupportTicket, TradeCardItem
from orders.scheduling import next_customer_pickup_date_for_timeslot
from orders.services import PROCESSING_BLUE, build_order_status_dm
from sctcgbot.libs.pickup_channels import PICKUP_CATEGORY_ID, active_pickup_names, ensure_rolling_window, expired_pickup_names, pickup_channel_name, pickup_role_name, rolling_pickup_dates
from sctcgbot.libs.pickup_roles import PickupLifecycleRunner, PickupRoleOutboxProcessor, boot_sync_pickup_roles, sync_member_pickup_roles
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

    def test_asap_checkout_does_not_depend_on_usable_scheduled_slots(self):
        RecurringTimeslot.objects.create(
            day_of_week=1,
            start_time='00:03',
            end_time='02:11',
            location='Bad Window',
            max_bookings=5,
            is_active=True,
        )

        response = self.client.post('/api/orders/checkout/', {
            'items': [{'item_id': self.item.id, 'quantity': 1}],
            'payment_method': 'venmo',
            'delivery_method': 'asap',
            'discord_handle': 'test#1234',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(user=self.user)
        self.assertEqual(order.delivery_method, 'asap')
        self.assertIsNone(order.recurring_timeslot_id)
        self.assertIsNone(order.pickup_date)

    def test_validate_coupon_applies_category_target(self):
        cards = Category.objects.get(slug='cards')
        boxes = Category.objects.get(slug='boxes')
        self.item.category = cards
        self.item.price = Decimal('10.00')
        self.item.save(update_fields=['category', 'price'])
        box = Item.objects.create(title='Box Item', stock=10, price=Decimal('20.00'), category=boxes)
        coupon = Coupon.objects.create(code='CARDS10', discount_percent=Decimal('10.00'))
        coupon.specific_categories.add(cards)

        response = self.client.post('/api/orders/validate-coupon/', {
            'code': 'CARDS10',
            'cart_items': [{'item_id': self.item.id, 'price': '10.00', 'quantity': 2}],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'active')
        self.assertEqual(response.data['specific_category_ids'], [cards.id])
        self.assertEqual(Decimal(response.data['computed_discount']), Decimal('2.00'))

        mismatch = self.client.post('/api/orders/validate-coupon/', {
            'code': 'CARDS10',
            'cart_items': [{'item_id': box.id, 'price': '20.00', 'quantity': 1}],
        }, format='json')

        self.assertEqual(mismatch.status_code, status.HTTP_200_OK)
        self.assertEqual(mismatch.data['status'], 'disabled')
        self.assertEqual(mismatch.data['disabled_reason'], 'Sorry, this coupon does not apply to items in your cart.')

    def test_checkout_coupon_discounts_only_targeted_category(self):
        cards = Category.objects.get(slug='cards')
        boxes = Category.objects.get(slug='boxes')
        self.item.category = cards
        self.item.price = Decimal('10.00')
        self.item.save(update_fields=['category', 'price'])
        box = Item.objects.create(title='Box Item', stock=10, price=Decimal('20.00'), category=boxes)
        coupon = Coupon.objects.create(code='CARDS10', discount_percent=Decimal('10.00'))
        coupon.specific_categories.add(cards)

        response = self.client.post('/api/orders/checkout/', {
            'items': [
                {'item_id': self.item.id, 'quantity': 1},
                {'item_id': box.id, 'quantity': 1},
            ],
            'payment_method': 'venmo',
            'delivery_method': 'asap',
            'discord_handle': 'test#1234',
            'coupon_code': 'CARDS10',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(user=self.user)
        self.assertEqual(order.discount_applied, Decimal('1.00'))

    def test_checkout_locks_coupon_inside_transaction(self):
        self.item.price = Decimal('10.00')
        self.item.save(update_fields=['price'])
        Coupon.objects.create(code='SCTCG', discount_percent=Decimal('20.00'))
        original_select_for_update = Coupon.objects.select_for_update
        lock_states = []

        def guarded_select_for_update(*args, **kwargs):
            in_atomic = transaction.get_connection().in_atomic_block
            lock_states.append(in_atomic)
            if not in_atomic:
                raise AssertionError('Coupon row was locked outside the checkout transaction')
            return original_select_for_update(*args, **kwargs)

        with patch.object(Coupon.objects, 'select_for_update', side_effect=guarded_select_for_update):
            response = self.client.post('/api/orders/checkout/', {
                'items': [{'item_id': self.item.id, 'quantity': 1}],
                'payment_method': 'venmo',
                'delivery_method': 'asap',
                'discord_handle': 'test#1234',
                'coupon_code': 'SCTCG',
            }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(lock_states, [True])
        order = Order.objects.get(user=self.user)
        self.assertEqual(order.coupon_code, 'SCTCG')
        self.assertEqual(order.discount_applied, Decimal('2.00'))
        coupon = Coupon.objects.get(code='SCTCG')
        self.assertEqual(coupon.times_used, 1)

    def test_scheduled_checkout_with_coupon_succeeds(self):
        self.item.price = Decimal('12.00')
        self.item.save(update_fields=['price'])
        Coupon.objects.create(code='SCTCG', discount_percent=Decimal('20.00'))
        pickup_day = datetime(2026, 4, 28).date()
        timeslot = RecurringTimeslot.objects.create(
            day_of_week=pickup_day.weekday(),
            start_time='14:00',
            end_time='14:30',
            location='Fountain',
            max_bookings=5,
            is_active=True,
        )

        with patch('orders.views.timezone.now', return_value=_utc_from_pacific(2026, 4, 27, 20, 0)):
            response = self.client.post('/api/orders/checkout/', {
                'items': [{'item_id': self.item.id, 'quantity': 1}],
                'payment_method': 'venmo',
                'delivery_method': 'scheduled',
                'recurring_timeslot_id': timeslot.id,
                'pickup_date': pickup_day.isoformat(),
                'discord_handle': 'test#1234',
                'coupon_code': 'SCTCG',
            }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(user=self.user)
        self.assertEqual(order.delivery_method, 'scheduled')
        self.assertEqual(order.pickup_date, pickup_day)
        self.assertEqual(order.coupon_code, 'SCTCG')
        self.assertEqual(order.discount_applied, Decimal('2.40'))

    def test_coupon_list_reports_redemptions_and_customers(self):
        self.user.is_admin = True
        self.user.save(update_fields=['is_admin'])
        second_user = User.objects.create_user(email='second@ucsc.edu', username='second')
        coupon = Coupon.objects.create(code='SCTCG', discount_percent=Decimal('20.00'), times_used=3)
        for user in (self.user, self.user, second_user):
            Order.objects.create(
                user=user,
                item=self.item,
                quantity=1,
                payment_method='venmo',
                delivery_method='asap',
                discord_handle='test#1234',
                coupon_code='sctcg',
                discount_applied=Decimal('2.00'),
            )
        Order.objects.create(
            user=second_user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='asap',
            discord_handle='test#1234',
            coupon_code='SCTCG',
            discount_applied=Decimal('0.00'),
        )

        response = self.client.get('/api/orders/coupons/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data['results'][0] if isinstance(response.data, dict) and 'results' in response.data else response.data[0]
        self.assertEqual(payload['id'], coupon.id)
        self.assertEqual(payload['times_used'], 3)
        self.assertEqual(payload['redemption_count'], 3)
        self.assertEqual(payload['customer_count'], 2)

    def test_checkout_rejects_unusable_recurring_timeslot(self):
        self.item.price = Decimal('9.00')
        self.item.save(update_fields=['price'])
        timeslot = RecurringTimeslot.objects.create(
            day_of_week=1,
            start_time='14:12',
            end_time='14:13',
            location='Bad Window',
            max_bookings=5,
            is_active=True,
        )

        response = self.client.post('/api/orders/checkout/', {
            'items': [{'item_id': self.item.id, 'quantity': 1}],
            'payment_method': 'venmo',
            'delivery_method': 'scheduled',
            'recurring_timeslot_id': timeslot.id,
            'pickup_date': next_customer_pickup_date_for_timeslot(timeslot).isoformat(),
            'discord_handle': 'test#1234',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'This pickup time is no longer available. Please choose another pickup time.')
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock, 10)
        self.assertFalse(Order.objects.filter(user=self.user).exists())

    def test_checkout_rejects_pickup_date_that_does_not_match_timeslot_day(self):
        timeslot = RecurringTimeslot.objects.create(
            day_of_week=1,
            start_time='14:00',
            end_time='15:00',
            location='Good Window',
            max_bookings=5,
            is_active=True,
        )

        response = self.client.post('/api/orders/checkout/', {
            'items': [{'item_id': self.item.id, 'quantity': 1}],
            'payment_method': 'venmo',
            'delivery_method': 'scheduled',
            'recurring_timeslot_id': timeslot.id,
            'pickup_date': (next_customer_pickup_date_for_timeslot(timeslot) + timedelta(days=1)).isoformat(),
            'discord_handle': 'test#1234',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Selected pickup date does not match the pickup timeslot day.')
        self.assertFalse(Order.objects.filter(user=self.user).exists())

    def test_checkout_stock_deduction_is_all_or_nothing(self):
        self.item.stock = 1
        self.item.save(update_fields=['stock'])
        sold_out_item = Item.objects.create(title='Sold Out Item', stock=0, max_per_user=5)

        response = self.client.post('/api/orders/checkout/', {
            'items': [
                {'item_id': self.item.id, 'quantity': 1},
                {'item_id': sold_out_item.id, 'quantity': 1},
            ],
            'payment_method': 'venmo',
            'delivery_method': 'asap',
            'discord_handle': 'test#1234',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Insufficient stock for Sold Out Item')
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock, 1)
        self.assertFalse(Order.objects.filter(user=self.user).exists())

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


class DiscordPickupRoleEventSignalTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='pickup-roles@example.com')
        self.item = Item.objects.create(title='Pickup Role Item', stock=10, price=Decimal('5.00'))

    def _run_order_signal_callbacks(self, action):
        with patch('orders.signals.notify_order_status_via_dm'), patch('orders.signals.notify_new_asap_order_to_admins'):
            with self.captureOnCommitCallbacks(execute=True):
                result = action()
        return result

    def _create_order(self, *, pickup_date=None, delivery_method='scheduled', status_value='pending'):
        return Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method=delivery_method,
            pickup_date=pickup_date,
            discord_handle='buyer#1234',
            status=status_value,
        )

    def test_active_pickup_order_writes_grant_event(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        UserProfile.objects.create(user=self.user, discord_id='123456789012345678')

        order = self._run_order_signal_callbacks(lambda: self._create_order(pickup_date=pickup_date))

        event = DiscordRoleEvent.objects.get()
        self.assertEqual(event.event_type, DiscordRoleEvent.EVENT_GRANT)
        self.assertEqual(event.discord_id, '123456789012345678')
        self.assertEqual(event.pickup_date, pickup_date)
        self.assertEqual(event.order_id, order.id)

    def test_asap_order_does_not_write_pickup_role_event(self):
        UserProfile.objects.create(user=self.user, discord_id='123456789012345678')

        self._run_order_signal_callbacks(lambda: self._create_order(delivery_method='asap'))

        self.assertFalse(DiscordRoleEvent.objects.exists())

    def test_cancelling_one_of_multiple_same_day_orders_keeps_role(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        UserProfile.objects.create(user=self.user, discord_id='123456789012345678')
        first_order = self._run_order_signal_callbacks(lambda: self._create_order(pickup_date=pickup_date))
        self._run_order_signal_callbacks(lambda: self._create_order(pickup_date=pickup_date))
        DiscordRoleEvent.objects.all().delete()

        def cancel_first_order():
            first_order.status = 'cancelled'
            first_order.save(update_fields=['status'])

        self._run_order_signal_callbacks(cancel_first_order)

        self.assertFalse(DiscordRoleEvent.objects.filter(event_type=DiscordRoleEvent.EVENT_REVOKE).exists())

    def test_cancelling_last_same_day_order_writes_revoke_event(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        UserProfile.objects.create(user=self.user, discord_id='123456789012345678')
        order = self._run_order_signal_callbacks(lambda: self._create_order(pickup_date=pickup_date))
        DiscordRoleEvent.objects.all().delete()

        def cancel_order():
            order.status = 'cancelled'
            order.save(update_fields=['status'])

        self._run_order_signal_callbacks(cancel_order)

        event = DiscordRoleEvent.objects.get()
        self.assertEqual(event.event_type, DiscordRoleEvent.EVENT_REVOKE)
        self.assertEqual(event.pickup_date, pickup_date)

    def test_reschedule_writes_revoke_for_old_date_and_grant_for_new_date(self):
        old_date = timezone.localdate() + timedelta(days=2)
        new_date = timezone.localdate() + timedelta(days=3)
        UserProfile.objects.create(user=self.user, discord_id='123456789012345678')
        order = self._run_order_signal_callbacks(lambda: self._create_order(pickup_date=old_date))
        DiscordRoleEvent.objects.all().delete()

        def reschedule_order():
            order.pickup_date = new_date
            order.save(update_fields=['pickup_date'])

        self._run_order_signal_callbacks(reschedule_order)

        events = list(DiscordRoleEvent.objects.order_by('created_at', 'id'))
        self.assertEqual([event.event_type for event in events], [DiscordRoleEvent.EVENT_REVOKE, DiscordRoleEvent.EVENT_GRANT])
        self.assertEqual(events[0].pickup_date, old_date)
        self.assertEqual(events[1].pickup_date, new_date)

    def test_late_discord_link_writes_grant_for_existing_pickup_order(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        profile = UserProfile.objects.create(user=self.user)
        order = self._run_order_signal_callbacks(lambda: self._create_order(pickup_date=pickup_date))
        DiscordRoleEvent.objects.all().delete()

        with self.captureOnCommitCallbacks(execute=True):
            profile.discord_id = '123456789012345678'
            profile.save(update_fields=['discord_id'])

        event = DiscordRoleEvent.objects.get()
        self.assertEqual(event.event_type, DiscordRoleEvent.EVENT_GRANT)
        self.assertEqual(event.discord_id, '123456789012345678')
        self.assertEqual(event.pickup_date, pickup_date)
        self.assertEqual(event.order_id, order.id)


class PickupChannelWindowTests(TestCase):
    def test_rolling_pickup_dates_include_today_through_next_seven_days(self):
        today = date(2026, 4, 28)

        pickup_dates = rolling_pickup_dates(today=today)
        names = active_pickup_names(today=today)

        self.assertEqual(pickup_dates[0], today)
        self.assertEqual(pickup_dates[-1], date(2026, 5, 5))
        self.assertEqual(len(pickup_dates), 8)
        self.assertIn('Pickup: 4/28', names['roles'])
        self.assertIn('Pickup: 5/5', names['roles'])
        self.assertIn('pickup-4-28', names['channels'])
        self.assertIn('pickup-5-5', names['channels'])

    def test_expired_pickup_names_are_generated_across_year_boundary(self):
        names = expired_pickup_names(today=date(2026, 1, 2), lookback_days=3)

        self.assertEqual(names['roles'], {'Pickup: 1/1', 'Pickup: 12/31', 'Pickup: 12/30'})
        self.assertEqual(names['channels'], {'pickup-1-1', 'pickup-12-31', 'pickup-12-30'})

    def test_configured_pickup_dates_follow_active_recurring_timeslots(self):
        today = date(2026, 4, 27)
        now = _utc_from_pacific(2026, 4, 27, 20, 59)
        for day_of_week in [1, 2, 3]:
            RecurringTimeslot.objects.create(
                day_of_week=day_of_week,
                start_time=dt_time(14, 0),
                end_time=dt_time(16, 0),
                is_active=True,
            )
        RecurringTimeslot.objects.create(
            day_of_week=4,
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=False,
        )

        self.assertEqual(configured_pickup_dates(today=today, now=now), [
            date(2026, 4, 28),
            date(2026, 4, 29),
            date(2026, 4, 30),
        ])

        RecurringTimeslot.objects.create(
            day_of_week=4,
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=True,
        )

        self.assertIn(date(2026, 5, 1), configured_pickup_dates(today=today, now=now))

    def test_configured_pickup_dates_ignore_unusable_recurring_timeslots(self):
        today = date(2026, 4, 27)
        now = _utc_from_pacific(2026, 4, 27, 20, 59)
        RecurringTimeslot.objects.create(
            day_of_week=1,
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=True,
        )
        RecurringTimeslot.objects.create(
            day_of_week=2,
            start_time=dt_time(0, 3),
            end_time=dt_time(2, 11),
            is_active=True,
        )

        self.assertEqual(configured_pickup_dates(today=today, now=now), [date(2026, 4, 28)])

    def test_configured_pickup_dates_roll_forward_after_booking_cutoff(self):
        today = date(2026, 4, 27)
        now = _utc_from_pacific(2026, 4, 27, 21, 0)
        RecurringTimeslot.objects.create(
            day_of_week=1,
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=True,
        )
        RecurringTimeslot.objects.create(
            day_of_week=2,
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=True,
        )

        self.assertEqual(configured_pickup_dates(today=today, now=now), [
            date(2026, 4, 29),
            date(2026, 5, 5),
        ])

    def test_active_order_keeps_closed_next_day_channel_until_pickup_rollover(self):
        today = date(2026, 4, 27)
        now = _utc_from_pacific(2026, 4, 27, 21, 0)
        pickup_date = date(2026, 4, 28)
        user = User.objects.create_user(email='active-pickup-channel@example.com')
        item = Item.objects.create(title='Active Pickup Channel Item', stock=1, max_per_user=0)
        RecurringTimeslot.objects.create(
            day_of_week=1,
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=True,
        )
        with patch('orders.signals.notify_order_status_via_dm'), patch('orders.signals.notify_new_asap_order_to_admins'):
            Order.objects.create(
                user=user,
                item=item,
                quantity=1,
                payment_method='venmo',
                delivery_method='scheduled',
                pickup_date=pickup_date,
                discord_handle='pickup#1234',
                status='pending',
            )

        self.assertEqual(configured_pickup_dates(today=today, now=now), [
            pickup_date,
            date(2026, 5, 5),
        ])

    def test_ensure_window_deletes_closed_future_dates_when_filtered(self):
        today = date(2026, 4, 28)
        valid_dates = [today, date(2026, 4, 29), date(2026, 4, 30), date(2026, 5, 5)]
        guild = FakeDiscordGuild()
        category = guild.channels[0]
        valid_channel = FakeDiscordChannel(pickup_channel_name(date(2026, 4, 30)), category=category)
        inactive_channel = FakeDiscordChannel(pickup_channel_name(date(2026, 5, 1)), category=category)
        valid_role = FakeDiscordRole(pickup_role_name(date(2026, 4, 30)))
        inactive_role = FakeDiscordRole(pickup_role_name(date(2026, 5, 1)))
        guild.channels.extend([valid_channel, inactive_channel])
        guild.roles.extend([valid_role, inactive_role])
        for channel in guild.channels:
            channel.guild = guild

        async_to_sync(ensure_rolling_window)(
            guild,
            category_id=PICKUP_CATEGORY_ID,
            today=today,
            pickup_dates=valid_dates,
        )

        self.assertFalse(valid_channel.deleted)
        self.assertFalse(valid_role.deleted)
        self.assertTrue(inactive_channel.deleted)
        self.assertTrue(inactive_role.deleted)

    def test_ensure_window_deletes_expired_previous_day_when_filtered(self):
        today = date(2026, 4, 29)
        next_week = date(2026, 5, 6)
        guild = FakeDiscordGuild()
        category = guild.channels[0]
        expired_channel = FakeDiscordChannel(pickup_channel_name(date(2026, 4, 28)), category=category)
        active_channel = FakeDiscordChannel(pickup_channel_name(next_week), category=category)
        expired_role = FakeDiscordRole(pickup_role_name(date(2026, 4, 28)))
        active_role = FakeDiscordRole(pickup_role_name(next_week))
        guild.channels.extend([expired_channel, active_channel])
        guild.roles.extend([expired_role, active_role])
        for channel in guild.channels:
            channel.guild = guild

        async_to_sync(ensure_rolling_window)(
            guild,
            category_id=PICKUP_CATEGORY_ID,
            today=today,
            pickup_dates=[next_week],
        )

        self.assertTrue(expired_channel.deleted)
        self.assertTrue(expired_role.deleted)
        self.assertFalse(active_channel.deleted)
        self.assertFalse(active_role.deleted)


class FakeDiscordRole:
    _next_id = 1000

    def __init__(self, name):
        self.name = name
        self.id = FakeDiscordRole._next_id
        FakeDiscordRole._next_id += 1
        self.deleted = False

    async def delete(self, reason=None):
        self.deleted = True


class FakeDiscordChannel:
    _next_id = 2000

    def __init__(self, name, *, channel_id=None, category=None):
        self.name = name
        self.id = channel_id or FakeDiscordChannel._next_id
        FakeDiscordChannel._next_id += 1
        self.category = category
        self.category_id = getattr(category, 'id', None)
        self.deleted = False

    async def delete(self, reason=None):
        self.deleted = True

    async def set_permissions(self, *args, **kwargs):
        return None

    async def create_text_channel(self, name, **kwargs):
        channel = FakeDiscordChannel(name, category=self)
        channel.guild = getattr(self, 'guild', None)
        if channel.guild:
            channel.guild.channels.append(channel)
        return channel


class FakeDiscordMember:
    def __init__(self, member_id, *, roles=None, add_exception=None):
        self.id = member_id
        self.roles = list(roles or [])
        self.guild = None
        self.added = []
        self.removed = []
        self.add_exception = add_exception

    async def add_roles(self, role, reason=None):
        if self.add_exception:
            raise self.add_exception
        if role not in self.roles:
            self.roles.append(role)
        self.added.append(role.name)

    async def remove_roles(self, role, reason=None):
        if role in self.roles:
            self.roles.remove(role)
        self.removed.append(role.name)


class FakeDiscordGuild:
    def __init__(self, *, roles=None, channels=None, members=None, chunked=True, category_id=PICKUP_CATEGORY_ID):
        self.id = 999
        self.roles = list(roles or [])
        self.category_id = category_id
        category = FakeDiscordChannel('pickup-category', channel_id=category_id)
        self.channels = [category, *list(channels or [])]
        self.members = list(members or [])
        self.chunked = chunked
        self.default_role = FakeDiscordRole('@everyone')
        for channel in self.channels:
            channel.guild = self
        for member in self.members:
            member.guild = self

    def get_member(self, member_id):
        for member in self.members:
            if str(member.id) == str(member_id):
                return member
        return None

    def get_channel(self, channel_id):
        for channel in self.channels:
            if str(channel.id) == str(channel_id):
                return channel
        return None

    async def create_role(self, name, reason=None):
        role = FakeDiscordRole(name)
        self.roles.append(role)
        return role

    async def create_text_channel(self, name, category=None, **kwargs):
        channel = FakeDiscordChannel(name, category=category)
        channel.guild = self
        self.channels.append(channel)
        return channel


class PickupRoleOutboxProcessorTests(TestCase):
    def setUp(self):
        self.today = date(2026, 4, 28)
        RecurringTimeslot.objects.create(
            day_of_week=self.today.weekday(),
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=True,
        )
        self.discord_id = '123456789012345678'
        self.role = FakeDiscordRole(pickup_role_name(self.today))
        self.member = FakeDiscordMember(int(self.discord_id))
        self.guild = FakeDiscordGuild(roles=[self.role], members=[self.member])
        self.processor = PickupRoleOutboxProcessor(
            category_id=self.guild.category_id,
            alert_channel_id='',
            mutation_sleep_seconds=0,
        )

    def _event(self, event_type, *, attempt_count=0):
        return DiscordRoleEvent.objects.create(
            event_type=event_type,
            discord_id=self.discord_id,
            pickup_date=self.today,
            attempt_count=attempt_count,
        )

    def _run_once(self):
        now = _utc_from_pacific(2026, 4, 27, 20, 59)
        with patch('orders.discord_pickup_roles.timezone.now', return_value=now):
            return async_to_sync(self.processor.run_once)(self.guild, today=self.today)

    def test_outbox_grant_adds_role_and_marks_processed(self):
        event = self._event(DiscordRoleEvent.EVENT_GRANT)

        result = self._run_once()

        event.refresh_from_db()
        self.assertEqual(result.processed, 1)
        self.assertIn(self.role, self.member.roles)
        self.assertEqual(self.member.added, [self.role.name])
        self.assertEqual(event.status, DiscordRoleEvent.STATUS_PROCESSED)

    def test_same_batch_grant_then_revoke_collapses_without_discord_calls(self):
        grant = self._event(DiscordRoleEvent.EVENT_GRANT)
        revoke = self._event(DiscordRoleEvent.EVENT_REVOKE)

        result = self._run_once()

        grant.refresh_from_db()
        revoke.refresh_from_db()
        self.assertEqual(result.ignored, 2)
        self.assertEqual(self.member.added, [])
        self.assertEqual(self.member.removed, [])
        self.assertEqual(grant.status, DiscordRoleEvent.STATUS_PROCESSED_IGNORED)
        self.assertEqual(revoke.status, DiscordRoleEvent.STATUS_PROCESSED_IGNORED)

    def test_missing_role_repairs_window_then_grants(self):
        self.guild.roles = []
        event = self._event(DiscordRoleEvent.EVENT_GRANT)

        async def repair_window(guild, **kwargs):
            guild.roles.append(self.role)
            return []

        with patch('sctcgbot.libs.pickup_roles.ensure_rolling_window', new=AsyncMock(side_effect=repair_window)) as ensure_window:
            result = self._run_once()

        event.refresh_from_db()
        self.assertEqual(ensure_window.await_count, 1)
        self.assertEqual(result.processed, 1)
        self.assertEqual(event.status, DiscordRoleEvent.STATUS_PROCESSED)
        self.assertIn(self.role, self.member.roles)

    def test_role_cap_marks_processed_with_warning(self):
        class RoleCapError(Exception):
            code = 30005

        self.guild.roles = []
        event = self._event(DiscordRoleEvent.EVENT_GRANT)

        with patch('sctcgbot.libs.pickup_roles.ensure_rolling_window', new=AsyncMock(side_effect=RoleCapError('maximum roles reached'))):
            result = self._run_once()

        event.refresh_from_db()
        self.assertEqual(result.warnings, 1)
        self.assertEqual(event.status, DiscordRoleEvent.STATUS_PROCESSED_WITH_WARNING)

    def test_retryable_failure_dead_letters_after_max_attempts(self):
        self.member.add_exception = RuntimeError('discord transient failure')
        event = self._event(DiscordRoleEvent.EVENT_GRANT, attempt_count=2)

        result = self._run_once()

        event.refresh_from_db()
        self.assertEqual(result.dead_lettered, 1)
        self.assertEqual(event.status, DiscordRoleEvent.STATUS_DEAD_LETTER)
        self.assertEqual(event.attempt_count, 3)


class PickupRoleBotApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='pickup-bot-api@example.com')
        self.profile = UserProfile.objects.create(user=self.user, discord_id='123456789012345678')
        self.item = Item.objects.create(title='Pickup Bot API Item', stock=3, max_per_user=0)
        self.today = date(2026, 4, 28)
        RecurringTimeslot.objects.create(
            day_of_week=self.today.weekday(),
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=True,
        )
        self.bot_api_key = BotAPIKey(name='Pickup Role Bot')
        self.raw_key = BotAPIKey.generate_key()
        self.bot_api_key.set_key(self.raw_key)
        self.bot_api_key.save()

    def _bot_post(self, path, data=None):
        return self.client.post(
            path,
            data or {},
            format='json',
            HTTP_X_SCTCG_BOT_API_KEY=self.raw_key,
        )

    def test_bot_can_claim_and_complete_pickup_role_event(self):
        event = DiscordRoleEvent.objects.create(
            event_type=DiscordRoleEvent.EVENT_GRANT,
            discord_id=self.profile.discord_id,
            pickup_date=self.today,
        )

        now = _utc_from_pacific(2026, 4, 27, 20, 59)
        with patch('orders.discord_pickup_roles.timezone.now', return_value=now):
            claim_response = self._bot_post('/api/orders/discord-pickup-role-events/claim/')

        self.assertEqual(claim_response.status_code, status.HTTP_200_OK)
        self.assertEqual(claim_response.data['count'], 1)
        self.assertEqual(claim_response.data['events'][0]['id'], event.id)
        event.refresh_from_db()
        self.assertEqual(event.status, DiscordRoleEvent.STATUS_PROCESSING)

        complete_response = self._bot_post('/api/orders/discord-pickup-role-events/complete/', {
            'event_id': event.id,
            'status': DiscordRoleEvent.STATUS_PROCESSED,
        })

        self.assertEqual(complete_response.status_code, status.HTTP_200_OK)
        event.refresh_from_db()
        self.assertEqual(event.status, DiscordRoleEvent.STATUS_PROCESSED)
        self.assertIsNotNone(event.processed_at)

    def test_bot_can_read_assignments_and_member_dates(self):
        with patch('orders.signals.notify_order_status_via_dm'), patch('orders.signals.notify_new_asap_order_to_admins'):
            Order.objects.create(
                user=self.user,
                item=self.item,
                quantity=1,
                payment_method='venmo',
                delivery_method='scheduled',
                pickup_date=self.today,
                discord_handle='pickup-bot#1234',
                status='pending',
            )

        now = _utc_from_pacific(2026, 4, 28, 20, 59)
        with patch('orders.discord_pickup_roles.timezone.now', return_value=now):
            assignments_response = self._bot_post('/api/orders/discord-pickup-role-assignments/')
            dates_response = self._bot_post('/api/orders/discord-pickup-member-dates/', {
                'discord_id': self.profile.discord_id,
            })

        self.assertEqual(assignments_response.status_code, status.HTTP_200_OK)
        self.assertEqual(assignments_response.data['assignments'], [{
            'pickup_date': self.today.isoformat(),
            'discord_ids': [self.profile.discord_id],
        }])
        self.assertEqual(dates_response.status_code, status.HTTP_200_OK)
        self.assertEqual(dates_response.data['pickup_dates'], [self.today.isoformat()])

    def test_bot_can_read_configured_pickup_dates(self):
        RecurringTimeslot.objects.create(
            day_of_week=2,
            start_time=dt_time(17, 0),
            end_time=dt_time(19, 0),
            is_active=True,
        )

        now = _utc_from_pacific(2026, 4, 27, 21, 0)
        with patch('orders.discord_pickup_roles.timezone.now', return_value=now):
            response = self._bot_post('/api/orders/discord-pickup-schedule-dates/', {
                'start_date': self.today.isoformat(),
                'window_days': 8,
            })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['pickup_dates'], [
            date(2026, 4, 29).isoformat(),
            date(2026, 5, 5).isoformat(),
        ])
        self.assertEqual(response.data['cancelled_expired_orders'], 0)

    def test_schedule_dates_keep_active_closed_pickup_and_cancel_it_at_rollover(self):
        with patch('orders.signals.notify_order_status_via_dm'), patch('orders.signals.notify_new_asap_order_to_admins'):
            order = Order.objects.create(
                user=self.user,
                item=self.item,
                quantity=2,
                payment_method='store_credit',
                delivery_method='scheduled',
                pickup_date=self.today,
                discord_handle='pickup-bot#1234',
                status='pending',
                store_credit_applied=Decimal('5.00'),
            )
        OrderItem.objects.create(order=order, item=self.item, quantity=2, price_at_purchase=Decimal('3.00'))
        self.item.stock = 0
        self.item.save(update_fields=['stock'])

        before_rollover = _utc_from_pacific(2026, 4, 28, 20, 59)
        with patch('orders.discord_pickup_roles.timezone.now', return_value=before_rollover):
            before_response = self._bot_post('/api/orders/discord-pickup-schedule-dates/', {
                'start_date': self.today.isoformat(),
                'window_days': 8,
            })

        self.assertEqual(before_response.status_code, status.HTTP_200_OK)
        self.assertIn(self.today.isoformat(), before_response.data['pickup_dates'])
        self.assertEqual(before_response.data['cancelled_expired_orders'], 0)

        after_rollover = _utc_from_pacific(2026, 4, 28, 21, 0)
        with patch('orders.discord_pickup_roles.timezone.now', return_value=after_rollover), \
                patch('orders.signals.notify_order_status_via_dm'), \
                self.captureOnCommitCallbacks(execute=True):
            after_response = self._bot_post('/api/orders/discord-pickup-schedule-dates/', {
                'start_date': self.today.isoformat(),
                'window_days': 8,
            })

        self.assertEqual(after_response.status_code, status.HTTP_200_OK)
        self.assertNotIn(self.today.isoformat(), after_response.data['pickup_dates'])
        self.assertEqual(after_response.data['cancelled_expired_orders'], 1)
        order.refresh_from_db()
        self.item.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(order.status, 'cancelled')
        self.assertEqual(self.item.stock, 2)
        self.assertEqual(self.profile.trade_credit_balance, Decimal('5.00'))
        self.assertTrue(CreditLedger.objects.filter(user=self.user, amount=Decimal('5.00')).exists())
        self.assertTrue(DiscordRoleEvent.objects.filter(
            event_type=DiscordRoleEvent.EVENT_REVOKE,
            pickup_date=self.today,
            discord_id=self.profile.discord_id,
        ).exists())

    def test_bot_can_claim_and_finish_lifecycle_run_once(self):
        claim_response = self._bot_post('/api/orders/discord-pickup-lifecycle/claim/', {
            'run_date': self.today.isoformat(),
        })
        duplicate_response = self._bot_post('/api/orders/discord-pickup-lifecycle/claim/', {
            'run_date': self.today.isoformat(),
        })
        finish_response = self._bot_post('/api/orders/discord-pickup-lifecycle/finish/', {
            'run_date': self.today.isoformat(),
            'status': DiscordPickupLifecycleRun.STATUS_COMPLETED,
        })

        lifecycle = DiscordPickupLifecycleRun.objects.get(run_date=self.today)
        self.assertEqual(claim_response.status_code, status.HTTP_200_OK)
        self.assertTrue(claim_response.data['claimed'])
        self.assertEqual(duplicate_response.status_code, status.HTTP_200_OK)
        self.assertFalse(duplicate_response.data['claimed'])
        self.assertEqual(finish_response.status_code, status.HTTP_200_OK)
        self.assertEqual(lifecycle.status, DiscordPickupLifecycleRun.STATUS_COMPLETED)


class PickupLifecycleRunnerTests(TestCase):
    def test_lifecycle_deletes_expired_exact_names_and_locks_daily_run(self):
        today = date(2026, 1, 2)
        category = FakeDiscordChannel('pickup-category', channel_id=PICKUP_CATEGORY_ID)
        expired_channel = FakeDiscordChannel(pickup_channel_name(date(2026, 1, 1)), category=category)
        active_channel = FakeDiscordChannel(pickup_channel_name(today), category=category)
        expired_role = FakeDiscordRole(pickup_role_name(date(2026, 1, 1)))
        active_role = FakeDiscordRole(pickup_role_name(today))
        guild = FakeDiscordGuild(
            roles=[expired_role, active_role],
            channels=[expired_channel, active_channel],
            members=[],
            category_id=PICKUP_CATEGORY_ID,
        )
        guild.channels[0] = category
        category.guild = guild
        runner = PickupLifecycleRunner(category_id=PICKUP_CATEGORY_ID)

        with patch('sctcgbot.libs.pickup_roles.ensure_rolling_window', new=AsyncMock(return_value=[])):
            result = async_to_sync(runner.run_once)(guild, today=today)
            skipped = async_to_sync(runner.run_once)(guild, today=today)

        lifecycle = DiscordPickupLifecycleRun.objects.get(run_date=today)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(skipped['status'], 'skipped')
        self.assertTrue(expired_channel.deleted)
        self.assertFalse(active_channel.deleted)
        self.assertTrue(expired_role.deleted)
        self.assertFalse(active_role.deleted)
        self.assertEqual(lifecycle.status, DiscordPickupLifecycleRun.STATUS_COMPLETED)


class PickupBootAndJoinSyncTests(TestCase):
    def test_boot_sync_aborts_when_guild_member_cache_is_suspicious(self):
        guild = FakeDiscordGuild(members=[FakeDiscordMember(1)], chunked=False)

        result = async_to_sync(boot_sync_pickup_roles)(guild, today=date(2026, 4, 28), force=True)

        self.assertEqual(result['status'], 'retry_later')
        self.assertEqual(result['retry_after_seconds'], 300)

    def test_member_join_sync_grants_active_pickup_role(self):
        today = date(2026, 4, 28)
        RecurringTimeslot.objects.create(
            day_of_week=today.weekday(),
            start_time=dt_time(14, 0),
            end_time=dt_time(16, 0),
            is_active=True,
        )
        discord_id = '123456789012345678'
        user = User.objects.create_user(email='pickup-join@example.com')
        UserProfile.objects.create(user=user, discord_id=discord_id)
        item = Item.objects.create(title='Join Sync Item', stock=3, max_per_user=0)
        with patch('orders.signals.notify_order_status_via_dm'), patch('orders.signals.notify_new_asap_order_to_admins'):
            Order.objects.create(
                user=user,
                item=item,
                quantity=1,
                payment_method='venmo',
                delivery_method='scheduled',
                pickup_date=today,
                discord_handle='joiner#1234',
                status='pending',
            )
        role = FakeDiscordRole(pickup_role_name(today))
        member = FakeDiscordMember(int(discord_id))
        guild = FakeDiscordGuild(roles=[role], members=[member])

        now = _utc_from_pacific(2026, 4, 28, 20, 59)
        with patch('sctcgbot.libs.pickup_roles.ensure_rolling_window', new=AsyncMock(return_value=[])), \
            patch('orders.discord_pickup_roles.timezone.now', return_value=now):
            result = async_to_sync(sync_member_pickup_roles)(member, today=today, mutation_sleep_seconds=0)

        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['added'], 1)
        self.assertIn(role, member.roles)


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


class OrderDiscordDisplayTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='discord-admin@example.com', username='discord-admin', is_admin=True)
        self.user = User.objects.create_user(email='ntboyd@ucsc.edu', username='ntboyd')
        self.profile = UserProfile.objects.create(user=self.user)
        self.item = Item.objects.create(title='Discord Display Item', stock=10, max_per_user=0, price='9.99')
        self.order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='venmo',
            delivery_method='asap',
            discord_handle='',
            status='pending',
        )

    def _link_discord_after_order(self):
        self.profile.discord_id = '123456789012345678'
        self.profile.discord_handle = 'ntb3'
        self.profile.no_discord = False
        self.profile.save(update_fields=['discord_id', 'discord_handle', 'no_discord'])

    def test_dispatch_queue_shows_discord_linked_after_order_creation(self):
        self._link_discord_after_order()
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/orders/dispatch/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.discord_handle, '')
        self.assertEqual(response.data[0]['user_email'], 'ntboyd@ucsc.edu')
        self.assertEqual(response.data[0]['discord_handle'], 'ntb3')

    def test_order_history_shows_discord_linked_after_order_creation(self):
        self._link_discord_after_order()
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/orders/admin-history/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get('results', response.data)
        self.assertEqual(payload[0]['user_email'], 'ntboyd@ucsc.edu')
        self.assertEqual(payload[0]['discord_handle'], 'ntb3')

    def test_dispatch_search_finds_discord_linked_after_order_creation(self):
        self._link_discord_after_order()
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/orders/dispatch/', {'search': 'ntb3'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], self.order.id)
        self.assertEqual(response.data[0]['discord_handle'], 'ntb3')

    def test_dashboard_dispatch_queue_includes_discord_linked_after_order_creation(self):
        self._link_discord_after_order()
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/orders/admin-dashboard/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['dispatch_queue'][0]['customer_email'], 'ntboyd@ucsc.edu')
        self.assertEqual(response.data['dispatch_queue'][0]['discord_handle'], 'ntb3')

    def test_dashboard_low_stock_counts_boxes_only(self):
        boxes_category, _ = Category.objects.get_or_create(slug='boxes', defaults={'name': 'Boxes'})
        cards_category, _ = Category.objects.get_or_create(slug='cards', defaults={'name': 'Cards'})
        Item.objects.create(title='Low Stock Box', category=boxes_category, stock=1, is_active=True)
        Item.objects.create(title='Low Stock Card', category=cards_category, stock=1, is_active=True)
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/orders/admin-dashboard/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['kpis']['low_stock'], 1)


class AdminMetricsApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='metrics-admin@example.com', username='metrics-admin', is_admin=True)
        self.user = User.objects.create_user(email='metrics-user@example.com', username='metrics-user')
        self.category = Category.objects.create(name='Boxes', slug='metrics-boxes')
        self.item = Item.objects.create(title='Metric Booster Box', category=self.category, stock=10, max_per_user=0, price='10.00')

    def _create_order(self, created_at, *, quantity=1, price='10.00', status_value='pending', payment_method='venmo'):
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=quantity,
            payment_method=payment_method,
            delivery_method='scheduled',
            discord_handle='metrics#1234',
            status=status_value,
        )
        OrderItem.objects.create(order=order, item=self.item, quantity=quantity, price_at_purchase=price)
        Order.objects.filter(pk=order.pk).update(created_at=created_at)
        order.refresh_from_db()
        return order

    def test_admin_metrics_returns_daily_graph_data(self):
        self._create_order(timezone.now(), quantity=2, price='10.00')
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/orders/admin-metrics/', {'days': 7})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['daily']), 7)
        self.assertEqual(response.data['summary']['orders'], 1)
        self.assertEqual(response.data['summary']['revenue'], 20.0)
        self.assertEqual(response.data['top_products'][0]['item_title'], 'Metric Booster Box')
        self.assertEqual(response.data['category_revenue'][0]['category'], 'Boxes')

    def test_admin_metrics_supports_all_time_range(self):
        self._create_order(timezone.now() - timedelta(days=140), quantity=1, price='9.00')
        self._create_order(timezone.now(), quantity=1, price='12.00')
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/orders/admin-metrics/', {'days': 'all'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['range']['all_time'])
        self.assertGreater(response.data['range']['days'], 90)
        self.assertEqual(response.data['summary']['orders'], 2)
        self.assertEqual(response.data['summary']['revenue'], 21.0)

    def test_dashboard_today_uses_pacific_midnight_window(self):
        local_tz = timezone.get_current_timezone()
        today_start = timezone.make_aware(datetime.combine(timezone.localdate(), dt_time.min), local_tz)
        self._create_order(today_start + timedelta(hours=1), quantity=1, price='7.00')
        self._create_order(today_start - timedelta(minutes=1), quantity=1, price='11.00')
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/orders/admin-dashboard/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['kpis']['todays_orders'], 1)
        self.assertEqual(response.data['kpis']['todays_revenue'], 7.0)
        self.assertIn('metrics_preview', response.data)


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

    def test_merge_cart_combines_matching_order_item_quantities(self):
        order = Order.objects.create(
            user=self.user,
            payment_method='venmo',
            delivery_method='asap',
            discord_handle='merge#1234',
            status='pending',
        )
        OrderItem.objects.create(order=order, item=self.existing_item, quantity=1, price_at_purchase='12.00')
        CartItem.objects.create(user=self.user, item=self.existing_item, quantity=2)

        response = self.client.post(f'/api/orders/{order.order_id}/merge-cart/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.existing_item.refresh_from_db()
        line = order.order_items.get()
        self.assertEqual(line.quantity, 3)
        self.assertEqual(self.existing_item.stock, 1)
        self.assertEqual(response.data['items_summary'], 'Existing Merge Item x3')
        self.assertEqual(len(response.data['display_items']), 1)
        self.assertEqual(response.data['display_items'][0]['quantity'], 3)

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


class AdminCreateOrderViewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email='admin-pos@example.com', username='admin-pos', is_admin=True)
        self.user = User.objects.create_user(email='pos-customer@example.com', username='pos-customer')
        self.item = Item.objects.create(title='POS Product', stock=5, max_per_user=0, price='10.00')
        self.client.force_authenticate(user=self.admin)

    def _payload(self, timeslot, pickup_date):
        return {
            'target_user_id': self.user.id,
            'items': [{'item_id': self.item.id, 'quantity': 1}],
            'payment_method': 'cash',
            'delivery_method': 'scheduled',
            'recurring_timeslot_id': timeslot.id,
            'pickup_date': pickup_date.isoformat(),
            'discord_handle': 'pos#1234',
        }

    def test_admin_create_order_allows_valid_scheduled_pickup(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        timeslot = RecurringTimeslot.objects.create(
            day_of_week=pickup_date.weekday(),
            start_time='14:00',
            end_time='15:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(pickup_date - timedelta(days=1), 20, 59)):
            response = self.client.post('/api/orders/admin/create-order/', self._payload(timeslot, pickup_date), format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(user=self.user)
        self.assertEqual(order.recurring_timeslot_id, timeslot.id)
        self.assertEqual(order.pickup_date, pickup_date)

    def test_admin_create_order_rejects_unusable_recurring_timeslot(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        timeslot = RecurringTimeslot.objects.create(
            day_of_week=pickup_date.weekday(),
            start_time='14:12',
            end_time='14:13',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(pickup_date - timedelta(days=1), 20, 59)):
            response = self.client.post('/api/orders/admin/create-order/', self._payload(timeslot, pickup_date), format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'This pickup time is no longer available. Please choose another pickup time.')
        self.assertFalse(Order.objects.filter(user=self.user).exists())

    def test_admin_create_order_rejects_mismatched_pickup_date(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        timeslot = RecurringTimeslot.objects.create(
            day_of_week=(pickup_date.weekday() + 1) % 7,
            start_time='14:00',
            end_time='15:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(pickup_date - timedelta(days=1), 20, 59)):
            response = self.client.post('/api/orders/admin/create-order/', self._payload(timeslot, pickup_date), format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Selected pickup date does not match the pickup timeslot day.')
        self.assertFalse(Order.objects.filter(user=self.user).exists())


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

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(tomorrow - timedelta(days=1), 20, 59)), \
            patch('orders.services.notify_customer_pickup_changed') as notify_customer:
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
        notify_customer.assert_called_once()

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

    def test_admin_can_convert_scheduled_order_to_asap(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        current_slot = RecurringTimeslot.objects.create(
            day_of_week=pickup_date.weekday(),
            start_time='11:30',
            end_time='12:00',
            max_bookings=3,
            is_active=True,
            location='Oakes Cafe',
        )
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='paypal',
            delivery_method='scheduled',
            recurring_timeslot=current_slot,
            pickup_date=pickup_date,
            discord_handle='buyer#1234',
            status='pending',
            is_acknowledged=True,
            asap_reminder_level=2,
        )
        self.client.force_authenticate(user=self.admin)

        with patch('orders.services.notify_order_converted_to_asap') as notify_admins, \
            patch('orders.services.notify_customer_pickup_changed') as notify_customer:
            response = self.client.post(
                '/api/orders/reschedule/',
                {
                    'order_id': order.id,
                    'delivery_method': 'asap',
                    'admin': True,
                },
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.delivery_method, 'asap')
        self.assertIsNone(order.recurring_timeslot_id)
        self.assertIsNone(order.pickup_date)
        self.assertIsNone(order.pickup_slot_id)
        self.assertIsNone(order.pickup_timeslot_id)
        self.assertFalse(order.is_acknowledged)
        self.assertEqual(order.asap_reminder_level, 0)
        self.assertEqual(order.resolution_summary[-1]['event'], 'converted_to_asap')
        notify_admins.assert_called_once()
        self.assertIn('Oakes Cafe', notify_admins.call_args.args[1])
        notify_customer.assert_called_once()

    def test_customer_cannot_convert_order_to_asap(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        current_slot = RecurringTimeslot.objects.create(
            day_of_week=pickup_date.weekday(),
            start_time='11:30',
            end_time='12:00',
            max_bookings=3,
            is_active=True,
            location='Oakes Cafe',
        )
        order = Order.objects.create(
            user=self.user,
            item=self.item,
            quantity=1,
            payment_method='paypal',
            delivery_method='scheduled',
            recurring_timeslot=current_slot,
            pickup_date=pickup_date,
            discord_handle='buyer#1234',
            status='pending',
        )

        response = self.client.post(
            '/api/orders/reschedule/',
            {
                'order_id': order.id,
                'delivery_method': 'asap',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        order.refresh_from_db()
        self.assertEqual(order.delivery_method, 'scheduled')

    def test_admin_reschedule_same_slot_returns_clear_error(self):
        pickup_date = timezone.localdate() + timedelta(days=2)
        current_slot = RecurringTimeslot.objects.create(
            day_of_week=pickup_date.weekday(),
            start_time='15:00',
            end_time='16:00',
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
            pickup_date=pickup_date,
            discord_handle='buyer#1234',
            status='pending',
        )
        self.client.force_authenticate(user=self.admin)

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(pickup_date - timedelta(days=1), 20, 59)):
            response = self.client.post(
                '/api/orders/reschedule/',
                {
                    'order_id': order.id,
                    'recurring_timeslot_id': current_slot.id,
                    'pickup_date': pickup_date.isoformat(),
                    'admin': True,
                },
                format='json',
            )

        readable_date = pickup_date.strftime('%A, %b %d').replace(' 0', ' ')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['error'],
            f'This order is already scheduled for {readable_date} • 03:00 - 04:00 • Campus. Choose a different pickup date or time.',
        )

    def test_reschedule_rejects_unusable_recurring_timeslot(self):
        current_pickup = timezone.localdate() + timedelta(days=3)
        tomorrow = timezone.localdate() + timedelta(days=1)
        current_slot = RecurringTimeslot.objects.create(
            day_of_week=current_pickup.weekday(),
            start_time='15:00',
            end_time='16:00',
            max_bookings=3,
            is_active=True,
            location='Campus',
        )
        bad_slot = RecurringTimeslot.objects.create(
            day_of_week=tomorrow.weekday(),
            start_time='14:12',
            end_time='14:13',
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

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(tomorrow - timedelta(days=1), 20, 59)):
            response = self.client.post(
                '/api/orders/reschedule/',
                {
                    'order_id': order.id,
                    'recurring_timeslot_id': bad_slot.id,
                    'pickup_date': tomorrow.isoformat(),
                },
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'This pickup time is no longer available. Please choose another pickup time.')
        order.refresh_from_db()
        self.assertEqual(order.recurring_timeslot_id, current_slot.id)

    def test_reschedule_rejects_pickup_date_that_does_not_match_timeslot_day(self):
        current_pickup = timezone.localdate() + timedelta(days=3)
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
            day_of_week=(tomorrow.weekday() + 1) % 7,
            start_time='14:00',
            end_time='15:00',
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

        with patch('orders.views.timezone.now', return_value=_utc_on_pacific_date(tomorrow - timedelta(days=1), 20, 59)):
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
        self.assertEqual(response.data['error'], 'Selected pickup date does not match the pickup timeslot day.')

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
