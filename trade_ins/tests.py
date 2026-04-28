from decimal import Decimal
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from inventory.models import PokeshopSettings, RecurringTimeslot, TCGCardPrice
from users.models import UserProfile

from .models import CreditLedger, TradeInItem, TradeInRequest


User = get_user_model()


class TradeInApiTests(APITestCase):
	def setUp(self):
		self.user = User.objects.create_user(
			email='trade-customer@example.com',
			username='trade-customer',
		)
		self.admin = User.objects.create_user(
			email='trade-admin@example.com',
			username='trade-admin',
			is_admin=True,
		)
		settings_obj = PokeshopSettings.load()
		settings_obj.trade_credit_percentage = Decimal('80.00')
		settings_obj.trade_cash_percentage = Decimal('65.00')
		settings_obj.trade_ins_enabled = True
		settings_obj.save()
		self.pickup_date = timezone.localdate() + timedelta(days=3)
		self.timeslot = RecurringTimeslot.objects.create(
			day_of_week=self.pickup_date.weekday(),
			start_time='14:00',
			end_time='16:00',
			location='Campus Center',
			max_bookings=2,
			is_active=True,
		)

	def _make_trade_in(self, *, status_value=TradeInRequest.STATUS_PENDING_REVIEW):
		trade_in = TradeInRequest.objects.create(
			user=self.user,
			submission_method='in_store_dropoff',
			status=status_value,
			payout_type=TradeInRequest.PAYOUT_TYPE_STORE_CREDIT,
			estimated_total_value=Decimal('110.00'),
			credit_percentage=Decimal('80.00'),
			recurring_timeslot=self.timeslot,
			pickup_date=self.pickup_date,
		)
		first_item = TradeInItem.objects.create(
			request=trade_in,
			card_name='Pikachu ex',
			set_name='Scarlet & Violet',
			card_number='063/198',
			condition='NM',
			quantity=2,
			user_estimated_price=Decimal('50.00'),
			base_market_price=Decimal('62.50'),
		)
		second_item = TradeInItem.objects.create(
			request=trade_in,
			card_name='Charmander',
			set_name='Obsidian Flames',
			card_number='026/197',
			condition='LP',
			quantity=1,
			user_estimated_price=Decimal('10.00'),
			base_market_price=Decimal('15.00'),
		)
		return trade_in, first_item, second_item

	def test_create_uses_admin_percentage_and_condition_multiplier(self):
		self.client.force_authenticate(user=self.user)

		payload = {
			'submission_method': 'in_store_dropoff',
			'recurring_timeslot': self.timeslot.id,
			'pickup_date': self.pickup_date.isoformat(),
			'customer_notes': 'Campus meetup works best.',
			'items': [
				{
					'card_name': 'Pikachu ex',
					'set_name': 'Scarlet & Violet',
					'card_number': '063/198',
					'condition': 'moderately_played',
					'quantity': 2,
					'user_estimated_price': '1.00',
					'image_url': 'https://example.com/pikachu.png',
					'base_market_price': '100.00',
				}
			],
		}

		with patch('trade_ins.views.notify_admins_new_trade_in'):
			response = self.client.post('/api/trade-ins/', payload, format='json')

		self.assertEqual(response.status_code, status.HTTP_201_CREATED)
		trade_in = TradeInRequest.objects.get(pk=response.data['id'])
		item = trade_in.items.get()
		self.assertEqual(trade_in.submission_method, 'in_store_dropoff')
		self.assertEqual(trade_in.recurring_timeslot, self.timeslot)
		self.assertEqual(trade_in.pickup_date, self.pickup_date)
		self.assertEqual(trade_in.credit_percentage, Decimal('80.00'))
		self.assertEqual(item.condition, 'MP')
		self.assertEqual(item.user_estimated_price, Decimal('56.00'))
		self.assertEqual(trade_in.estimated_total_value, Decimal('112.00'))

	def test_create_oracle_lookup_falls_back_by_product_id(self):
		TCGCardPrice.objects.create(
			product_id=675822,
			name='Mega Meganium ex',
			clean_name='Mega Meganium ex',
			group_id=24541,
			group_name='ME: Ascended Heroes',
			sub_type_name='Holofoil',
			market_price='12.00',
			image_url='https://images.example.com/meganium.png',
			tcgplayer_url='https://www.tcgplayer.com/product/675822/pokemon-me-ascended-heroes-mega-meganium-ex',
		)
		self.client.force_authenticate(user=self.user)

		payload = {
			'submission_method': 'in_store_dropoff',
			'recurring_timeslot': self.timeslot.id,
			'pickup_date': self.pickup_date.isoformat(),
			'items': [
				{
					'card_name': 'Mega Meganium ex',
					'condition': 'near_mint',
					'quantity': 1,
					'user_estimated_price': '1.00',
					'tcg_product_id': 675822,
					'tcg_sub_type': 'Stage 1, MEGA, ex',
				}
			],
		}

		with patch('trade_ins.views.notify_admins_new_trade_in'):
			response = self.client.post('/api/trade-ins/', payload, format='json')

		self.assertEqual(response.status_code, status.HTTP_201_CREATED)
		item = TradeInRequest.objects.get(pk=response.data['id']).items.get()
		self.assertEqual(item.base_market_price, Decimal('12.00'))
		self.assertEqual(item.user_estimated_price, Decimal('9.60'))
		self.assertEqual(item.tcg_sub_type, 'Holofoil')
		self.assertEqual(item.image_url, 'https://images.example.com/meganium.png')
		self.assertEqual(item.tcgplayer_url, 'https://www.tcgplayer.com/product/675822/pokemon-me-ascended-heroes-mega-meganium-ex')

	def test_create_cash_trade_uses_cash_percentage_and_requires_method(self):
		self.client.force_authenticate(user=self.user)

		payload = {
			'submission_method': 'in_store_dropoff',
			'payout_type': 'cash',
			'cash_payment_method': 'venmo',
			'recurring_timeslot': self.timeslot.id,
			'pickup_date': self.pickup_date.isoformat(),
			'items': [
				{
					'card_name': 'Pikachu ex',
					'condition': 'near_mint',
					'quantity': 1,
					'user_estimated_price': '1.00',
					'base_market_price': '20.00',
				}
			],
		}

		with patch('trade_ins.views.notify_admins_new_trade_in'):
			response = self.client.post('/api/trade-ins/', payload, format='json')

		self.assertEqual(response.status_code, status.HTTP_201_CREATED)
		trade_in = TradeInRequest.objects.get(pk=response.data['id'])
		self.assertEqual(trade_in.payout_type, TradeInRequest.PAYOUT_TYPE_CASH)
		self.assertEqual(trade_in.cash_payment_method, 'venmo')
		self.assertEqual(trade_in.credit_percentage, Decimal('65.00'))
		self.assertEqual(trade_in.estimated_total_value, Decimal('13.00'))

		missing_method_response = self.client.post('/api/trade-ins/', {
			'submission_method': 'in_store_dropoff',
			'payout_type': 'cash',
			'recurring_timeslot': self.timeslot.id,
			'pickup_date': self.pickup_date.isoformat(),
			'items': [
				{
					'card_name': 'Eevee',
					'condition': 'near_mint',
					'quantity': 1,
					'user_estimated_price': '10.00',
				}
			],
		}, format='json')

		self.assertEqual(missing_method_response.status_code, status.HTTP_400_BAD_REQUEST)
		self.assertIn('cash_payment_method', missing_method_response.data)

	def test_create_accepts_checkout_style_raw_estimated_value_for_manual_cards(self):
		self.client.force_authenticate(user=self.user)

		payload = {
			'submission_method': 'in_store_dropoff',
			'recurring_timeslot': self.timeslot.id,
			'pickup_date': self.pickup_date.isoformat(),
			'items': [
				{
					'card_name': 'Manual Mewtwo',
					'condition': 'near_mint',
					'quantity': 2,
					'estimated_value': '10.00',
				},
			],
		}

		with patch('trade_ins.views.notify_admins_new_trade_in'):
			response = self.client.post('/api/trade-ins/', payload, format='json')

		self.assertEqual(response.status_code, status.HTTP_201_CREATED)
		trade_in = TradeInRequest.objects.get(pk=response.data['id'])
		item = trade_in.items.get()
		self.assertEqual(item.user_estimated_price, Decimal('8.00'))
		self.assertEqual(trade_in.estimated_total_value, Decimal('16.00'))

	def test_create_requires_pickup_timeslot(self):
		self.client.force_authenticate(user=self.user)

		response = self.client.post('/api/trade-ins/', {
			'submission_method': 'in_store_dropoff',
			'items': [
				{
					'card_name': 'Pikachu ex',
					'condition': 'near_mint',
					'quantity': 1,
					'user_estimated_price': '10.00',
				}
			],
		}, format='json')

		self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
		self.assertIn('recurring_timeslot', response.data)

	def test_admin_review_can_send_card_level_counteroffer(self):
		trade_in, first_item, second_item = self._make_trade_in()
		self.client.force_authenticate(user=self.admin)

		payload = {
			'send_counteroffer': True,
			'counteroffer_message': 'We can take Pikachu, but not Charmander this time.',
			'card_decisions': {
				str(first_item.id): {'decision': 'accept', 'overridden_value': '45.25'},
				str(second_item.id): {'decision': 'reject'},
			},
		}

		with patch('trade_ins.views.notify_customer_trade_in_counteroffer'):
			response = self.client.post(
				f'/api/trade-ins/admin/{trade_in.id}/review/',
				payload,
				format='json',
			)

		self.assertEqual(response.status_code, status.HTTP_200_OK)
		trade_in.refresh_from_db()
		first_item.refresh_from_db()
		second_item.refresh_from_db()
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_PENDING_COUNTEROFFER)
		self.assertEqual(trade_in.final_payout_value, Decimal('90.50'))
		self.assertIsNotNone(trade_in.counteroffer_expires_at)
		self.assertTrue(first_item.is_accepted)
		self.assertEqual(first_item.admin_override_value, Decimal('45.25'))
		self.assertFalse(second_item.is_accepted)

	def test_admin_review_rejects_negative_override(self):
		trade_in, first_item, second_item = self._make_trade_in()
		self.client.force_authenticate(user=self.admin)

		response = self.client.post(
			f'/api/trade-ins/admin/{trade_in.id}/review/',
			{
				'card_decisions': {
					str(first_item.id): {'decision': 'accept', 'overridden_value': '-1.00'},
					str(second_item.id): {'decision': 'accept'},
				},
			},
			format='json',
		)

		self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
		trade_in.refresh_from_db()
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_PENDING_REVIEW)

	def test_admin_review_requires_counteroffer_when_using_overrides(self):
		trade_in, first_item, second_item = self._make_trade_in()
		self.client.force_authenticate(user=self.admin)

		response = self.client.post(
			f'/api/trade-ins/admin/{trade_in.id}/review/',
			{
				'card_decisions': {
					str(first_item.id): {'decision': 'accept', 'overridden_value': '47.00'},
					str(second_item.id): {'decision': 'reject'},
				},
				'send_counteroffer': False,
			},
			format='json',
		)

		self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
		self.assertIn('send_counteroffer', response.data)
		trade_in.refresh_from_db()
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_PENDING_REVIEW)

	def test_admin_cannot_rereview_pending_counteroffer(self):
		trade_in, first_item, second_item = self._make_trade_in(
			status_value=TradeInRequest.STATUS_PENDING_COUNTEROFFER,
		)
		self.client.force_authenticate(user=self.admin)

		response = self.client.post(
			f'/api/trade-ins/admin/{trade_in.id}/review/',
			{
				'send_counteroffer': False,
				'card_decisions': {
					str(first_item.id): {'decision': 'accept'},
					str(second_item.id): {'decision': 'accept'},
				},
			},
			format='json',
		)

		self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
		self.assertEqual(response.data['error'], 'Only trade-ins awaiting initial review can be reviewed.')
		trade_in.refresh_from_db()
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_PENDING_COUNTEROFFER)

	def test_customer_accepts_counteroffer_and_admin_completes_wallet_payout(self):
		trade_in, first_item, second_item = self._make_trade_in(
			status_value=TradeInRequest.STATUS_PENDING_COUNTEROFFER,
		)
		trade_in.final_payout_value = Decimal('90.50')
		trade_in.counteroffer_message = 'Pikachu only.'
		trade_in.save(update_fields=['final_payout_value', 'counteroffer_message'])
		first_item.is_accepted = True
		first_item.admin_override_value = Decimal('45.25')
		first_item.save(update_fields=['is_accepted', 'admin_override_value'])
		second_item.is_accepted = False
		second_item.save(update_fields=['is_accepted'])
		self.client.force_authenticate(user=self.user)

		with patch('trade_ins.views.notify_admins_trade_in_counteroffer_response'), patch('trade_ins.views.notify_customer_trade_in_approved'):
			response = self.client.post(
				f'/api/trade-ins/{trade_in.id}/respond-counteroffer/',
				{'response': 'accept'},
				format='json',
			)

		self.assertEqual(response.status_code, status.HTTP_200_OK)
		trade_in.refresh_from_db()
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_APPROVED_PENDING_RECEIPT)

		self.client.force_authenticate(user=self.admin)
		with patch('trade_ins.views.notify_customer_trade_in_completed'):
			complete_response = self.client.post(f'/api/trade-ins/admin/{trade_in.id}/complete/')

		self.assertEqual(complete_response.status_code, status.HTTP_200_OK)
		trade_in.refresh_from_db()
		profile = UserProfile.objects.get(user=self.user)
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_COMPLETED)
		self.assertEqual(profile.trade_credit_balance, Decimal('90.50'))
		self.assertTrue(
			CreditLedger.objects.filter(
				user=self.user,
				amount=Decimal('90.50'),
				transaction_type=CreditLedger.TYPE_TRADE_IN_PAYOUT,
				reference_id=f'trade_in:{trade_in.id}',
			).exists()
		)

	def test_cash_trade_completion_does_not_fund_wallet(self):
		trade_in, _, _ = self._make_trade_in(
			status_value=TradeInRequest.STATUS_APPROVED_PENDING_RECEIPT,
		)
		trade_in.payout_type = TradeInRequest.PAYOUT_TYPE_CASH
		trade_in.cash_payment_method = 'paypal'
		trade_in.final_payout_value = Decimal('42.00')
		trade_in.save(update_fields=['payout_type', 'cash_payment_method', 'final_payout_value'])
		self.client.force_authenticate(user=self.admin)

		with patch('trade_ins.views.notify_customer_trade_in_completed'):
			response = self.client.post(f'/api/trade-ins/admin/{trade_in.id}/complete/')

		self.assertEqual(response.status_code, status.HTTP_200_OK)
		trade_in.refresh_from_db()
		profile, _ = UserProfile.objects.get_or_create(user=self.user)
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_COMPLETED)
		self.assertEqual(profile.trade_credit_balance, Decimal('0'))
		self.assertFalse(CreditLedger.objects.filter(reference_id=f'trade_in:{trade_in.id}').exists())

	def test_customer_declines_counteroffer(self):
		trade_in, _, _ = self._make_trade_in(
			status_value=TradeInRequest.STATUS_PENDING_COUNTEROFFER,
		)
		trade_in.final_payout_value = Decimal('90.50')
		trade_in.save(update_fields=['final_payout_value'])
		self.client.force_authenticate(user=self.user)

		with patch('trade_ins.views.notify_admins_trade_in_counteroffer_response'), patch('trade_ins.views.notify_customer_trade_in_rejected'):
			response = self.client.post(
				f'/api/trade-ins/{trade_in.id}/respond-counteroffer/',
				{'response': 'decline'},
				format='json',
			)

		self.assertEqual(response.status_code, status.HTTP_200_OK)
		trade_in.refresh_from_db()
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_REJECTED)
		self.assertEqual(trade_in.admin_notes, 'Customer declined the counteroffer.')

	def test_admin_can_reject_pending_counteroffer(self):
		trade_in, _, _ = self._make_trade_in(
			status_value=TradeInRequest.STATUS_PENDING_COUNTEROFFER,
		)
		self.client.force_authenticate(user=self.admin)

		with patch('trade_ins.views.notify_customer_trade_in_rejected'):
			response = self.client.post(
				f'/api/trade-ins/admin/{trade_in.id}/reject/',
				{'admin_notes': 'Not viable after review.'},
				format='json',
			)

		self.assertEqual(response.status_code, status.HTTP_200_OK)
		trade_in.refresh_from_db()
		self.assertEqual(trade_in.status, TradeInRequest.STATUS_REJECTED)
		self.assertEqual(trade_in.admin_notes, 'Not viable after review.')
