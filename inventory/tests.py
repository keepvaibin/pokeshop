from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
import requests
from rest_framework.test import APIClient
from unittest.mock import Mock, patch

from .models import AccessCode, BackgroundJob, Category, Item, ItemTag, PokeshopSettings, RecurringTimeslot
from .models import TCGCardPrice, WantedCard, WantedCardImage
from .services import fetch_tcg_card
from orders.models import Order


PACIFIC_TZ = ZoneInfo('America/Los_Angeles')


def _pacific_time(year, month, day, hour, minute=0, second=0):
	return datetime(year, month, day, hour, minute, second, tzinfo=PACIFIC_TZ)


class CoreCategoryProtectionTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		self.admin_user = get_user_model().objects.create_user(
			email='admin@example.com',
			password='password123',
			is_staff=True,
		)
		self.client.force_authenticate(self.admin_user)

	def test_core_category_cannot_be_deleted(self):
		category = Category.objects.get(slug='cards')

		response = self.client.delete(f'/api/inventory/categories/{category.slug}/')

		self.assertEqual(response.status_code, 403)
		self.assertTrue(Category.objects.filter(pk=category.pk).exists())

	def test_custom_category_can_be_renamed(self):
		category = Category.objects.create(name='Plushies', slug='plushies', is_core=False)

		response = self.client.patch(
			f'/api/inventory/categories/{category.slug}/',
			{'name': 'Desk Plushies', 'slug': 'desk-plushies'},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		category.refresh_from_db()
		self.assertEqual(category.name, 'Desk Plushies')
		self.assertEqual(category.slug, 'desk-plushies')


class ItemSearchTests(TestCase):
	def _public_card(self, title, **overrides):
		category = Category.objects.get(slug='cards')
		defaults = {
			'category': category,
			'is_active': True,
			'stock': 1,
			'published_at': timezone.now(),
		}
		defaults.update(overrides)
		return Item.objects.create(title=title, **defaults)

	def test_global_search_matches_custom_tags(self):
		category = Category.objects.create(name='Merchandise', slug='merchandise')
		tag = ItemTag.objects.create(category=category, name='Charizard Gear')
		item = Item.objects.create(
			title='Display Stand',
			category=category,
			is_active=True,
			stock=1,
			published_at=timezone.now(),
		)
		item.tags.add(tag)

		response = self.client.get('/api/inventory/items/', {'q': 'charizard'})

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertEqual(len(results), 1)
		self.assertEqual(results[0]['title'], 'Display Stand')

	def test_exact_printed_rarity_filter_is_separate_from_rarity_group(self):
		self._public_card('Spidops ex', rarity='Double Rare', rarity_type='Rare')
		self._public_card('Plain Rare', rarity='Rare', rarity_type='Rare')

		response = self.client.get('/api/inventory/items/', {'rarity': 'Double Rare'})

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertEqual([result['title'] for result in results], ['Spidops ex'])

	def test_playability_filters_use_subtype_regulation_and_standard_legality(self):
		self._public_card(
			'Awakening Drum',
			rarity='ACE SPEC Rare',
			rarity_type='Rare',
			tcg_subtypes='Item, Ancient, ACE SPEC',
			regulation_mark='H',
			standard_legal=True,
		)
		self._public_card(
			'Old Trainer',
			rarity='Rare',
			rarity_type='Rare',
			tcg_subtypes='Item',
			regulation_mark='E',
			standard_legal=False,
		)

		response = self.client.get('/api/inventory/items/', {
			'tcg_subtype': 'ACE SPEC',
			'regulation_mark': 'H',
			'standard_legal': '1',
		})

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertEqual([result['title'] for result in results], ['Awakening Drum'])


class SettingsAndTimeslotApiTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		self.admin_user = get_user_model().objects.create_user(
			email='settings-admin@example.com',
			password='password123',
			is_staff=True,
		)

	def test_settings_response_includes_footer_toggle(self):
		settings_obj = PokeshopSettings.load()
		settings_obj.show_footer_newsletter = False
		settings_obj.ucsc_discord_invite = 'https://discord.gg/ucsc-slugs'
		settings_obj.public_discord_invite = 'https://discord.gg/sctcg-public'
		settings_obj.save()

		response = self.client.get('/api/inventory/settings/')

		self.assertEqual(response.status_code, 200)
		self.assertIn('show_footer_newsletter', response.json())
		self.assertFalse(response.json()['show_footer_newsletter'])
		self.assertEqual(response.json()['ucsc_discord_invite'], 'https://discord.gg/ucsc-slugs')
		self.assertEqual(response.json()['public_discord_invite'], 'https://discord.gg/sctcg-public')

	def test_admin_can_update_footer_toggle(self):
		self.client.force_authenticate(self.admin_user)

		response = self.client.patch(
			'/api/inventory/settings/1/',
			{
				'show_footer_newsletter': False,
				'ucsc_discord_invite': 'https://discord.gg/ucsc-admin',
				'public_discord_invite': 'https://discord.gg/public-admin',
			},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertFalse(PokeshopSettings.load().show_footer_newsletter)
		self.assertEqual(PokeshopSettings.load().ucsc_discord_invite, 'https://discord.gg/ucsc-admin')
		self.assertEqual(PokeshopSettings.load().public_discord_invite, 'https://discord.gg/public-admin')

	def test_admin_can_update_standard_legality_marks(self):
		self.client.force_authenticate(self.admin_user)
		cards_category = Category.objects.get(slug='cards')
		legal_card = Item.objects.create(
			title='Mega Legal Card',
			category=cards_category,
			tcg_set_name='Mega Evolution',
			regulation_mark='H',
			stock=1,
			price='1.00',
			standard_legal=None,
			published_at=timezone.now(),
		)
		illegal_card = Item.objects.create(
			title='Rotated Card',
			category=cards_category,
			tcg_set_name='Scarlet & Violet',
			regulation_mark='G',
			stock=1,
			price='1.00',
			standard_legal=True,
			published_at=timezone.now(),
		)

		response = self.client.patch(
			'/api/inventory/settings/1/',
			{
				'standard_legal_marks': [' h ', 'H', 'I'],
				'standard_illegal_marks': ['G'],
			},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertEqual(payload['standard_legal_marks'], ['H', 'I'])
		self.assertEqual(payload['standard_illegal_marks'], ['G'])
		self.assertIn('H', payload['regulation_mark_options'])
		legal_card.refresh_from_db()
		illegal_card.refresh_from_db()
		self.assertTrue(legal_card.standard_legal)
		self.assertFalse(illegal_card.standard_legal)

	def test_standard_legality_marks_cannot_overlap(self):
		self.client.force_authenticate(self.admin_user)

		response = self.client.patch(
			'/api/inventory/settings/1/',
			{
				'standard_legal_marks': ['H'],
				'standard_illegal_marks': ['h'],
			},
			format='json',
		)

		self.assertEqual(response.status_code, 400)

	def test_public_recurring_timeslots_include_location(self):
		RecurringTimeslot.objects.create(
			day_of_week=2,
			start_time='14:00',
			end_time='16:00',
			location='Crown College Courtyard',
			max_bookings=6,
			is_active=True,
		)

		response = self.client.get('/api/inventory/recurring-timeslots/')

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertEqual(results[0]['location'], 'Crown College Courtyard')

	def test_public_recurring_timeslots_show_tomorrow_before_pacific_cutoff(self):
		RecurringTimeslot.objects.create(
			day_of_week=1,
			start_time='14:00',
			end_time='16:00',
			location='Crown College Courtyard',
			max_bookings=6,
			is_active=True,
		)

		with patch('orders.scheduling.timezone.now', return_value=_pacific_time(2026, 4, 27, 20)):
			response = self.client.get('/api/inventory/recurring-timeslots/')

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertEqual(results[0]['pickup_date'], '2026-04-28')

	def test_public_recurring_timeslots_roll_to_next_week_after_pacific_cutoff(self):
		RecurringTimeslot.objects.create(
			day_of_week=1,
			start_time='14:00',
			end_time='16:00',
			location='Crown College Courtyard',
			max_bookings=6,
			is_active=True,
		)

		with patch('orders.scheduling.timezone.now', return_value=_pacific_time(2026, 4, 27, 22)):
			response = self.client.get('/api/inventory/recurring-timeslots/')

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertEqual(results[0]['pickup_date'], '2026-05-05')

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
		pickup_date = date(2026, 4, 28)
		timeslot = RecurringTimeslot.objects.create(
			day_of_week=pickup_date.weekday(),
			start_time='14:00',
			end_time='16:00',
			location='Crown College Courtyard',
			max_bookings=6,
			is_active=True,
		)
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

		with patch('orders.scheduling.timezone.now', return_value=_pacific_time(2026, 4, 27, 20)):
			response = self.client.get('/api/inventory/recurring-timeslots/')

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertEqual(results[0]['pickup_date'], pickup_date.isoformat())
		self.assertEqual(results[0]['bookings_this_week'], 2)

	def test_public_recurring_timeslots_batch_booking_counts(self):
		pickup_date = date(2026, 4, 28)
		user = get_user_model().objects.create_user(email='timeslot-batch@example.com', username='timeslot-batch')
		item = Item.objects.create(title='Recurring Slot Item', stock=10, max_per_user=0, price='5.00')

		for index in range(3):
			timeslot = RecurringTimeslot.objects.create(
				day_of_week=pickup_date.weekday(),
				start_time=f'{14 + index}:00',
				end_time=f'{15 + index}:00',
				location=f'Crown {index}',
				max_bookings=6,
				is_active=True,
			)
			Order.objects.create(
				user=user,
				item=item,
				quantity=1,
				payment_method='venmo',
				delivery_method='scheduled',
				recurring_timeslot=timeslot,
				pickup_date=pickup_date,
				discord_handle='batch#1234',
				status='pending',
			)

		with patch('orders.scheduling.timezone.now', return_value=_pacific_time(2026, 4, 27, 20)):
			with CaptureQueriesContext(connection) as queries:
				response = self.client.get('/api/inventory/recurring-timeslots/')

		self.assertEqual(response.status_code, 200)
		self.assertLessEqual(len(queries), 4)


class WantedCardApiPerformanceTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		self.admin_user = get_user_model().objects.create_user(
			email='wanted-admin@example.com',
			password='password123',
			is_staff=True,
		)

	def test_public_wanted_cards_prefetch_images_and_tcg_cards(self):
		for index in range(3):
			tcg_card = TCGCardPrice.objects.create(
				product_id=9000 + index,
				name=f'Wanted Card {index}',
				clean_name=f'Wanted Card {index}',
				group_id=100 + index,
				group_name='Test Group',
				sub_type_name='Normal',
				rarity='Rare',
				market_price='12.50',
			)
			card = WantedCard.objects.create(
				name=f'Wanted Card {index}',
				estimated_value='12.50',
				is_active=True,
				tcg_card=tcg_card,
			)
			WantedCardImage.objects.create(
				card=card,
				image=SimpleUploadedFile(f'wanted-{index}.jpg', b'fake-image-bytes', content_type='image/jpeg'),
			)

		with CaptureQueriesContext(connection) as queries:
			response = self.client.get('/api/inventory/wanted/')

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertEqual(len(results), 3)
		self.assertLessEqual(len(queries), 4)

	def test_tcg_linked_wanted_card_exposes_tcg_image_without_upload(self):
		tcg_card = TCGCardPrice.objects.create(
			product_id=590006,
			name='Milotic ex',
			clean_name='Milotic ex',
			group_id=24000,
			group_name='Test Set',
			image_url='https://images.example.com/milotic-ex.png',
			tcgplayer_url='https://www.tcgplayer.com/product/590006/milotic-ex',
			sub_type_name='Holofoil',
			rarity='Special Illustration Rare',
			market_price='114.12',
		)
		self.client.force_authenticate(self.admin_user)

		response = self.client.post('/api/inventory/wanted/', {
			'name': 'Milotic ex',
			'estimated_value': '114.12',
			'description': '',
			'is_active': True,
			'tcg_product_id': tcg_card.product_id,
			'tcg_sub_type': 'Holofoil',
		}, format='json')

		self.assertEqual(response.status_code, 201)
		self.assertEqual(response.json()['images'][0]['url'], 'https://images.example.com/milotic-ex.png')
		self.assertEqual(response.json()['images'][0]['source'], 'tcg_card')
		self.assertFalse(WantedCardImage.objects.exists())

		list_response = self.client.get('/api/inventory/wanted/')
		self.assertEqual(list_response.status_code, 200)
		results = list_response.json()['results'] if isinstance(list_response.json(), dict) else list_response.json()
		self.assertEqual(results[0]['images'][0]['url'], 'https://images.example.com/milotic-ex.png')

	def test_uploaded_wanted_image_takes_precedence_over_tcg_image(self):
		tcg_card = TCGCardPrice.objects.create(
			product_id=590006,
			name='Milotic ex',
			clean_name='Milotic ex',
			group_id=24000,
			group_name='Test Set',
			image_url='https://images.example.com/milotic-ex.png',
			sub_type_name='Holofoil',
			market_price='114.12',
		)
		card = WantedCard.objects.create(
			name='Milotic ex',
			estimated_value='114.12',
			is_active=True,
			tcg_card=tcg_card,
		)
		WantedCardImage.objects.create(
			card=card,
			image=SimpleUploadedFile('milotic-upload.jpg', b'fake-image-bytes', content_type='image/jpeg'),
		)

		response = self.client.get('/api/inventory/wanted/')

		self.assertEqual(response.status_code, 200)
		results = response.json()['results'] if isinstance(response.json(), dict) else response.json()
		self.assertIn('/media/wanted_images/', results[0]['images'][0]['url'])
		self.assertNotIn('source', results[0]['images'][0])


class AccessCodeApiTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		self.admin_user = get_user_model().objects.create_user(
			email='access-admin@example.com',
			password='password123',
			is_staff=True,
		)
		self.client.force_authenticate(self.admin_user)

	def test_create_ignores_read_only_fields(self):
		response = self.client.post(
			'/api/inventory/access-codes/',
			{
				'code': 'SPRING-ACCESS',
				'usage_limit': 2,
				'times_used': 99,
			},
			format='json',
		)

		self.assertEqual(response.status_code, 201)
		access_code = AccessCode.objects.get(code='SPRING-ACCESS')
		self.assertEqual(access_code.times_used, 0)


class ItemPublishingBehaviorTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		self.admin_user = get_user_model().objects.create_user(
			email='inventory-admin@example.com',
			password='password123',
			is_staff=True,
		)
		self.client.force_authenticate(self.admin_user)

	def test_create_without_publish_date_goes_live_immediately(self):
		before_request = timezone.now()

		response = self.client.post(
			'/api/inventory/items/',
			{
				'title': 'Fresh Pulls',
				'price': '4.99',
				'stock': 3,
				'max_per_user': 1,
			},
			format='json',
		)

		self.assertEqual(response.status_code, 201)
		item = Item.objects.get(slug=response.json()['slug'])
		self.assertIsNotNone(item.published_at)
		self.assertGreaterEqual(item.published_at, before_request)

	def test_full_update_with_blank_publish_date_goes_live_immediately(self):
		item = Item.objects.create(title='Hidden Stock', published_at=None, stock=1, price='3.00')
		before_request = timezone.now()

		response = self.client.put(
			f'/api/inventory/items/{item.slug}/',
			{
				'title': item.title,
				'description': '',
				'short_description': '',
				'price': '3.00',
				'stock': 1,
				'max_per_user': 1,
				'is_active': True,
				'published_at': '',
			},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		item.refresh_from_db()
		self.assertIsNotNone(item.published_at)
		self.assertGreaterEqual(item.published_at, before_request)

	def test_partial_update_without_publish_date_keeps_existing_draft_state(self):
		item = Item.objects.create(title='Existing Draft', published_at=None, stock=2, price='2.00', is_active=True)

		response = self.client.patch(
			f'/api/inventory/items/{item.slug}/',
			{'is_active': False},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		item.refresh_from_db()
		self.assertIsNone(item.published_at)

	# --------------------------------------------------------------------------
	# BUG REGRESSION: Toggle-active on a draft must publish the item so the
	# public storefront can find it.  Without published_at the public queryset
	# filters the item out → "Product not found".
	# --------------------------------------------------------------------------

	def test_draft_toggle_without_published_at_stays_hidden_on_public_api(self):
		"""
		PROVES THE BUG: a PATCH of { is_active: true, show_when_out_of_stock: true }
		with no published_at leaves the item invisible on the public storefront.
		"""
		item = Item.objects.create(
			title='Hidden Draft Item',
			published_at=None,
			is_active=False,
			stock=1,
			price='9.99',
		)

		# Simulate what the OLD frontend toggle sent (no published_at)
		self.client.patch(
			f'/api/inventory/items/{item.slug}/',
			{'is_active': True, 'show_when_out_of_stock': True},
			format='json',
		)
		item.refresh_from_db()

		# Backend saved the flags correctly
		self.assertTrue(item.is_active)
		# But published_at was never set
		self.assertIsNone(item.published_at)

		# Public (unauthenticated) API cannot see the item — this is "Product not found"
		public_client = APIClient()
		response = public_client.get(f'/api/inventory/items/{item.slug}/')
		self.assertEqual(response.status_code, 404)

	def test_toggle_with_published_at_makes_item_visible_on_public_api(self):
		"""
		PROVES THE FIX: sending published_at in the same PATCH makes the item
		appear on the public storefront immediately.
		"""
		item = Item.objects.create(
			title='About To Go Live',
			published_at=None,
			is_active=False,
			stock=1,
			price='9.99',
		)
		before = timezone.now()

		# Simulate what the FIXED frontend toggle sends
		self.client.patch(
			f'/api/inventory/items/{item.slug}/',
			{
				'is_active': True,
				'show_when_out_of_stock': True,
				'published_at': before.isoformat(),
			},
			format='json',
		)
		item.refresh_from_db()

		self.assertTrue(item.is_active)
		self.assertIsNotNone(item.published_at)
		self.assertLessEqual(item.published_at, timezone.now())

		# Public API now returns the item
		public_client = APIClient()
		response = public_client.get(f'/api/inventory/items/{item.slug}/')
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.json()['slug'], item.slug)

	def test_oos_item_with_published_at_can_be_made_active(self):
		"""
		EXACT PRODUCTION REPRO: item with stock=0, is_active=False, published_at already set.
		PATCH {is_active: true, show_when_out_of_stock: true} must persist is_active=True.
		"""
		item = Item.objects.create(
			title='OOS Hidden Box',
			stock=0,
			is_active=False,
			published_at=timezone.now(),
			show_when_out_of_stock=True,
			price='35.00',
		)

		response = self.client.patch(
			f'/api/inventory/items/{item.slug}/',
			{'is_active': True, 'show_when_out_of_stock': True},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		# Response must reflect the NEW value
		self.assertTrue(response.json()['is_active'], 'response is_active should be True')
		self.assertEqual(response.json()['availability_status'], 'oos', 'status should be oos not inactive')
		# DB must persist it
		item.refresh_from_db()
		self.assertTrue(item.is_active, 'DB is_active should be True after patch')

		# And the public API must find it
		public_client = APIClient()
		pub = public_client.get(f'/api/inventory/items/{item.slug}/')
		self.assertEqual(pub.status_code, 200, 'Public API should return 200 for OOS+active+published item')

	def test_create_without_max_per_user_defaults_to_unlimited(self):
		response = self.client.post(
			'/api/inventory/items/',
			{
				'title': 'Unlimited Pull Box',
				'price': '14.99',
				'stock': 6,
			},
			format='json',
		)

		self.assertEqual(response.status_code, 201)
		item = Item.objects.get(slug=response.json()['slug'])
		self.assertEqual(item.max_per_user, 0)


class ItemAvailabilityStateTests(TestCase):
	def setUp(self):
		self.client = APIClient()

	def test_stock_drop_to_zero_does_not_auto_deactivate_item(self):
		item = Item.objects.create(
			title='Always Visible Item',
			stock=1,
			price='5.00',
			is_active=True,
			published_at=timezone.now(),
		)

		item.stock = 0
		item.save(update_fields=['stock'])
		item.refresh_from_db()

		self.assertTrue(item.is_active)

	def test_inventory_api_exposes_oos_availability_status(self):
		Item.objects.create(
			title='OOS API Item',
			stock=0,
			price='7.00',
			is_active=True,
			published_at=timezone.now(),
		)

		response = self.client.get('/api/inventory/items/')
		self.assertEqual(response.status_code, 200)

		payload = response.json()
		results = payload['results'] if isinstance(payload, dict) and 'results' in payload else payload
		self.assertGreaterEqual(len(results), 1)
		self.assertEqual(results[0]['availability_status'], 'oos')


class TCGImportPricingTests(TestCase):
	@patch('inventory.management.commands.sync_tcg_prices.requests.get')
	def test_download_json_uses_tcgcsv_request_headers(self, mock_get):
		from inventory.management.commands.sync_tcg_prices import download_json

		response = Mock()
		response.raise_for_status.return_value = None
		response.json.return_value = {'success': True, 'results': []}
		mock_get.return_value = response

		with TemporaryDirectory() as temp_dir:
			data = download_json('https://tcgcsv.com/tcgplayer/3/groups', Path(temp_dir) / 'Groups_3.json', force=True)

		self.assertEqual(data, {'success': True, 'results': []})
		request_kwargs = mock_get.call_args.kwargs
		self.assertIn('headers', request_kwargs)
		self.assertIn('User-Agent', request_kwargs['headers'])
		self.assertIn('application/json', request_kwargs['headers']['Accept'])

	@patch('inventory.management.commands.sync_tcg_prices.requests.get')
	def test_download_json_returns_live_data_when_cache_write_fails(self, mock_get):
		from inventory.management.commands.sync_tcg_prices import download_json

		response = Mock()
		response.raise_for_status.return_value = None
		response.json.return_value = {'success': True, 'results': [{'groupId': 24541}]}
		mock_get.return_value = response

		with TemporaryDirectory() as temp_dir:
			with patch('inventory.management.commands.sync_tcg_prices.open', side_effect=OSError('read-only'), create=True):
				data = download_json('https://tcgcsv.com/tcgplayer/3/groups', Path(temp_dir) / 'Groups_3.json', force=True)

		self.assertEqual(data, {'success': True, 'results': [{'groupId': 24541}]})

	@patch('inventory.services.fetch_tcg_card')
	def test_tcg_search_endpoint_returns_rich_card_results(self, mock_fetch):
		cache.clear()
		mock_fetch.return_value = [
			{
				'product_id': 98765,
				'api_id': 'trade-98765-normal',
				'name': 'Database Dragon ex',
				'clean_name': 'Database Dragon ex',
				'group_name': 'Test Group',
				'set_name': 'Test Set',
				'sub_type_name': 'Normal',
				'rarity': 'Double Rare',
				'market_price': 12.34,
				'image_large': 'https://images.example.com/database-dragon.png',
				'number': '042',
				'set_printed_total': '123',
				'tcgplayer_url': 'https://www.tcgplayer.com/product/98765',
				'price_source': 'Trade Database',
			},
		]

		response = self.client.get('/api/inventory/tcg-search/', {'q': 'Database Dragon'})

		self.assertEqual(response.status_code, 200)
		result = response.json()['results'][0]
		self.assertEqual(result['product_id'], 98765)
		self.assertEqual(result['name'], 'Database Dragon ex')
		self.assertEqual(result['image_url'], 'https://images.example.com/database-dragon.png')
		self.assertEqual(result['image_large'], 'https://images.example.com/database-dragon.png')
		self.assertEqual(result['image_small'], 'https://images.example.com/database-dragon.png')
		self.assertEqual(result['tcgplayer_url'], 'https://www.tcgplayer.com/product/98765')
		self.assertEqual(result['price_source'], 'Trade Database')
		self.assertEqual(result['short_description'], 'Database Dragon ex')
		self.assertEqual(result['tcg_subtypes'], 'Normal')
		self.assertEqual(result['tcg_price_sub_type'], 'Normal')

	@patch('inventory.services.fetch_tcg_card')
	def test_tcg_search_and_import_share_canonical_cached_results(self, mock_fetch):
		cache.clear()
		admin_user = get_user_model().objects.create_user(
			email='inventory-admin@example.com',
			password='password123',
			is_staff=True,
		)
		mock_fetch.return_value = [
			{
				'product_id': 22222,
				'api_id': 'shared-22222',
				'name': 'Shared Dragon',
				'set_name': 'Unified Set',
				'tcg_subtypes': 'Holofoil',
				'rarity': 'Rare Holo',
				'market_price': 9.99,
				'image_small': 'https://images.example.com/shared-small.png',
				'image_large': 'https://images.example.com/shared-large.png',
				'number': '025',
				'set_printed_total': '182',
				'tcgplayer_url': 'https://www.tcgplayer.com/product/22222',
				'price_source': 'Trade Database',
				'short_description': 'Shared Dragon 025/182',
			},
		]

		search_response = self.client.get('/api/inventory/tcg-search/', {'q': 'Shared Dragon', 'limit': 40})
		self.assertEqual(search_response.status_code, 200)

		authenticated_client = APIClient()
		authenticated_client.force_authenticate(admin_user)
		import_response = authenticated_client.get('/api/inventory/tcg-import/', {'q': 'Shared Dragon', 'limit': 40})

		self.assertEqual(import_response.status_code, 200)
		self.assertEqual(mock_fetch.call_count, 1)
		self.assertEqual(search_response.json()['results'], import_response.json()['results'])

	@patch('inventory.services.fetch_tcg_card')
	def test_admin_tcg_inventory_search_marks_existing_stock(self, mock_fetch):
		cache.clear()
		admin_user = get_user_model().objects.create_user(
			email='inventory-search-admin@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		cards_category = Category.objects.get(slug='cards')
		Item.objects.create(
			title='Database Dragon ex',
			category=cards_category,
			api_id='trade-98765-normal',
			tcg_set_name='Test Set',
			card_number='042',
			tcg_subtypes='Normal',
			stock=7,
			price='12.00',
			is_active=True,
			published_at=timezone.now(),
		)
		mock_fetch.return_value = [
			{
				'product_id': 98765,
				'api_id': 'trade-98765-normal',
				'name': 'Database Dragon ex',
				'set_name': 'Test Set',
				'sub_type_name': 'Normal',
				'rarity': 'Double Rare',
				'market_price': 12.34,
				'image_large': 'https://images.example.com/database-dragon.png',
				'number': '042',
				'set_printed_total': '123',
				'price_source': 'Trade Database',
			},
		]

		response = client.get('/api/inventory/tcg-inventory-search/', {'q': 'Database Dragon'})

		self.assertEqual(response.status_code, 200)
		result = response.json()['results'][0]
		self.assertTrue(result['exists'])
		self.assertEqual(result['action'], 'add_stock')
		self.assertEqual(result['inventory_item']['stock'], 7)

	@patch('inventory.services.fetch_tcg_card')
	def test_admin_tcg_inventory_search_does_not_cross_match_product_variants(self, mock_fetch):
		cache.clear()
		admin_user = get_user_model().objects.create_user(
			email='inventory-search-variants@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		cards_category = Category.objects.get(slug='cards')
		regular_item = Item.objects.create(
			title='Melmetal ex',
			category=cards_category,
			api_id='trade-200-normal',
			tcg_set_name='Stellar Crown',
			card_number='105',
			tcg_subtypes='Normal',
			stock=1,
			price='0.70',
			is_active=True,
			published_at=timezone.now(),
		)
		mock_fetch.return_value = [
			{
				'product_id': 100,
				'api_id': 'trade-100-normal',
				'name': 'Melmetal ex',
				'set_name': 'Miscellaneous Cards & Products',
				'sub_type_name': 'Normal',
				'rarity': 'Double Rare',
				'market_price': 0.65,
				'image_large': 'https://images.example.com/melmetal-stamped.png',
				'number': '105',
				'price_source': 'Trade Database',
			},
			{
				'product_id': 200,
				'api_id': 'trade-200-normal',
				'name': 'Melmetal ex',
				'set_name': 'Stellar Crown',
				'sub_type_name': 'Normal',
				'rarity': 'Double Rare',
				'market_price': 0.70,
				'image_large': 'https://images.example.com/melmetal-regular.png',
				'number': '105',
				'price_source': 'Trade Database',
			},
		]

		response = client.get('/api/inventory/tcg-inventory-search/', {'q': 'Melmetal ex'})

		self.assertEqual(response.status_code, 200)
		results = response.json()['results']
		stamped_result = next(result for result in results if result['card']['product_id'] == 100)
		regular_result = next(result for result in results if result['card']['product_id'] == 200)
		self.assertFalse(stamped_result['exists'])
		self.assertIsNone(stamped_result['inventory_item'])
		self.assertEqual(stamped_result['action'], 'add_to_database')
		self.assertTrue(regular_result['exists'])
		self.assertEqual(regular_result['inventory_item']['id'], regular_item.id)
		self.assertEqual(regular_result['inventory_item']['stock'], 1)

	@patch('inventory.services.fetch_tcg_card')
	def test_admin_tcg_inventory_search_matches_existing_card_without_trade_id(self, mock_fetch):
		cache.clear()
		admin_user = get_user_model().objects.create_user(
			email='inventory-search-existing-card@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		cards_category = Category.objects.get(slug='cards')
		existing_item = Item.objects.create(
			title='Mega Starmie ex',
			category=cards_category,
			api_id='sv-perfect-order-021',
			tcg_set_name='Perfect Order',
			card_number='021',
			tcg_subtypes='Stage 1, MEGA, ex',
			stock=2,
			price='1.50',
			is_active=True,
			published_at=timezone.now(),
		)
		mock_fetch.return_value = [
			{
				'product_id': 777021,
				'api_id': 'trade-777021-normal',
				'name': 'Mega Starmie ex',
				'clean_name': 'Mega Starmie ex',
				'set_name': 'Perfect Order',
				'sub_type_name': 'Stage 1, MEGA, ex',
				'tcg_subtypes': 'Stage 1, MEGA, ex',
				'rarity': 'Double Rare',
				'market_price': 1.19,
				'image_large': 'https://images.example.com/mega-starmie.png',
				'number': '021',
				'set_printed_total': '100',
				'price_source': 'Trade Database',
			},
		]

		response = client.get('/api/inventory/tcg-inventory-search/', {'q': 'Mega Starmie ex', 'limit': 24})

		self.assertEqual(response.status_code, 200)
		result = response.json()['results'][0]
		self.assertTrue(result['exists'])
		self.assertEqual(result['action'], 'add_stock')
		self.assertEqual(result['inventory_item']['id'], existing_item.id)
		self.assertEqual(result['inventory_item']['stock'], 2)

	@patch('inventory.services.fetch_tcg_card')
	def test_admin_tcg_inventory_search_uses_local_trade_database_first(self, mock_fetch):
		cache.clear()
		admin_user = get_user_model().objects.create_user(
			email='inventory-search-local@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		cards_category = Category.objects.get(slug='cards')
		existing_item = Item.objects.create(
			title='Tyranitar ex',
			category=cards_category,
			api_id='sv-test-set-088',
			tcg_set_name='Test Set',
			card_number='088',
			tcg_subtypes='Holofoil',
			stock=3,
			price='4.00',
			is_active=True,
			published_at=timezone.now(),
		)
		TCGCardPrice.objects.create(
			product_id=555001,
			name='Tyranitar ex - 088/182',
			clean_name='Tyranitar ex 088 182',
			group_id=321,
			group_name='SV: Test Set',
			image_url='https://images.example.com/tyranitar.png',
			tcgplayer_url='https://www.tcgplayer.com/product/555001',
			card_number='088',
			set_printed_total='182',
			sub_type_name='Holofoil',
			rarity='Double Rare',
			market_price='4.20',
		)

		response = client.get('/api/inventory/tcg-inventory-search/', {'q': 'tyranitar', 'limit': 24})

		self.assertEqual(response.status_code, 200)
		mock_fetch.assert_not_called()
		result = response.json()['results'][0]
		self.assertEqual(result['card']['product_id'], 555001)
		self.assertEqual(result['card']['price_source'], 'Trade Database Search')
		self.assertEqual(result['card']['image_large'], 'https://images.example.com/tyranitar.png')
		self.assertTrue(result['exists'])
		self.assertEqual(result['action'], 'add_stock')
		self.assertEqual(result['inventory_item']['id'], existing_item.id)
		self.assertEqual(result['inventory_item']['stock'], 3)

	@patch('inventory.services.fetch_tcg_card')
	def test_tcg_search_endpoint_dedupes_duplicate_results(self, mock_fetch):
		cache.clear()
		mock_fetch.return_value = [
			{
				'product_id': 98765,
				'api_id': 'api-a',
				'name': 'Mega Starmie ex',
				'set_name': 'Perfect Order',
				'tcg_subtypes': 'Stage 1, MEGA, ex',
				'rarity': 'Special Illustration Rare',
				'market_price': 78.83,
				'image_large': 'https://images.example.com/starmie-a.png',
				'number': '118',
				'set_printed_total': '88',
				'tcgplayer_url': 'https://www.tcgplayer.com/product/98765',
				'price_source': 'Trade Database',
			},
			{
				'product_id': 98765,
				'api_id': 'api-b',
				'name': 'Mega Starmie ex',
				'set_name': 'Perfect Order',
				'tcg_subtypes': 'Holofoil',
				'rarity': 'Special Illustration Rare',
				'market_price': 78.83,
				'image_large': 'https://images.example.com/starmie-b.png',
				'number': '118',
				'set_printed_total': '88',
				'tcgplayer_url': 'https://www.tcgplayer.com/product/98765',
				'price_source': 'Trade Database',
			},
		]

		response = self.client.get('/api/inventory/tcg-search/', {'q': 'Mega Starmie'})

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.json()['results']), 1)

	def test_admin_cards_endpoint_filters_missing_card_metadata(self):
		admin_user = get_user_model().objects.create_user(
			email='card-list-admin@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		cards_category = Category.objects.get(slug='cards')
		boxes_category = Category.objects.get(slug='boxes')
		missing_card = Item.objects.create(
			title='Missing Regulation Card',
			category=cards_category,
			tcg_set_name='Test Set',
			card_number='010',
			stock=1,
			price='1.00',
			is_active=True,
			published_at=timezone.now(),
		)
		Item.objects.create(
			title='Synced Regulation Card',
			category=cards_category,
			tcg_set_name='Test Set',
			card_number='011',
			regulation_mark='H',
			stock=1,
			price='1.00',
			is_active=True,
			published_at=timezone.now(),
		)
		Item.objects.create(
			title='Sealed Box',
			category=boxes_category,
			stock=1,
			price='20.00',
			is_active=True,
			published_at=timezone.now(),
		)

		response = client.get('/api/inventory/admin/cards/', {'missing': 'regulation_mark', 'page_size': 10})

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertEqual(payload['count'], 1)
		self.assertEqual(payload['results'][0]['id'], missing_card.id)
		self.assertIn('H', payload['facets']['regulation_marks'])

	@patch('inventory.services.fetch_tcg_card')
	@patch('inventory.views._start_background_card_sync_job')
	def test_admin_card_property_sync_enqueues_and_status_reports_completion(self, mock_start_job, mock_fetch):
		cache.clear()
		admin_user = get_user_model().objects.create_user(
			email='card-sync-admin@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		cards_category = Category.objects.get(slug='cards')
		item = Item.objects.create(
			title='Pikachu ex',
			category=cards_category,
			tcg_set_name='Test Set',
			card_number='025',
			stock=1,
			price='4.00',
			is_active=True,
			published_at=timezone.now(),
		)
		mock_fetch.return_value = [
			{
				'api_id': 'sv-test-025',
				'name': 'Pikachu ex',
				'clean_name': 'Pikachu ex',
				'set_name': 'Test Set',
				'number': '025',
				'set_printed_total': '100',
				'rarity': 'Double Rare',
				'tcg_type': 'Lightning',
				'tcg_stage': 'Basic',
				'tcg_supertype': 'Pokémon',
				'tcg_subtypes': 'Basic, ex',
				'tcg_hp': 190,
				'regulation_mark': 'H',
				'standard_legal': True,
				'tcg_legalities': {'standard': 'Legal'},
			}
		]

		response = client.post(
			'/api/inventory/admin/cards/sync-properties/',
			{'item_ids': [item.id], 'fields': ['tcg_type', 'regulation_mark']},
			format='json',
		)

		self.assertEqual(response.status_code, 202)
		payload = response.json()
		job = BackgroundJob.objects.get(id=payload['job_id'])
		self.assertEqual(job.status, BackgroundJob.Status.PENDING)
		mock_start_job.assert_called_once_with(str(job.id))

		from inventory.views import _run_card_property_sync_job
		_run_card_property_sync_job(str(job.id))

		status_response = client.get(f'/api/inventory/admin/jobs/{job.id}/')
		self.assertEqual(status_response.status_code, 200)
		status_payload = status_response.json()
		self.assertEqual(status_payload['status'], BackgroundJob.Status.COMPLETED)
		self.assertEqual(status_payload['result_data']['updated'], 1)
		item.refresh_from_db()
		self.assertEqual(item.tcg_type, 'Lightning')
		self.assertEqual(item.regulation_mark, 'H')
		self.assertIsNone(item.tcg_hp)
		self.assertIsNone(item.standard_legal)

	@patch('inventory.services.fetch_tcg_card')
	@patch('inventory.views._start_background_card_sync_job')
	def test_admin_card_property_sync_filtered_scope_only_updates_cards(self, mock_start_job, mock_fetch):
		cache.clear()
		admin_user = get_user_model().objects.create_user(
			email='card-sync-filter-admin@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		cards_category = Category.objects.get(slug='cards')
		boxes_category = Category.objects.get(slug='boxes')
		card_item = Item.objects.create(
			title='Bulbasaur',
			category=cards_category,
			tcg_set_name='Test Set',
			card_number='001',
			stock=1,
			price='1.00',
			is_active=True,
			published_at=timezone.now(),
		)
		sealed_item = Item.objects.create(
			title='Bulbasaur Box',
			category=boxes_category,
			stock=1,
			price='20.00',
			is_active=True,
			published_at=timezone.now(),
		)
		mock_fetch.return_value = [
			{
				'api_id': 'sv-test-001',
				'name': 'Bulbasaur',
				'set_name': 'Test Set',
				'number': '001',
				'set_printed_total': '100',
				'regulation_mark': 'G',
				'standard_legal': True,
			}
		]

		response = client.post(
			'/api/inventory/admin/cards/sync-properties/',
			{'filters': {}, 'fields': ['regulation_mark']},
			format='json',
		)

		self.assertEqual(response.status_code, 202)
		job = BackgroundJob.objects.get(id=response.json()['job_id'])
		mock_start_job.assert_called_once_with(str(job.id))

		from inventory.views import _run_card_property_sync_job
		_run_card_property_sync_job(str(job.id))

		job.refresh_from_db()
		self.assertEqual(job.status, BackgroundJob.Status.COMPLETED)
		self.assertEqual(job.result_data['processed'], 1)
		card_item.refresh_from_db()
		sealed_item.refresh_from_db()
		self.assertEqual(card_item.regulation_mark, 'G')
		self.assertIsNone(sealed_item.regulation_mark)

	@patch('inventory.services.fetch_tcg_card')
	@patch('inventory.views._start_background_card_sync_job')
	def test_admin_card_property_sync_respects_standard_legality_mark_override(self, mock_start_job, mock_fetch):
		cache.clear()
		settings_obj = PokeshopSettings.load()
		settings_obj.standard_illegal_marks = ['H']
		settings_obj.save(update_fields=['standard_illegal_marks'])
		admin_user = get_user_model().objects.create_user(
			email='card-sync-override-admin@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		cards_category = Category.objects.get(slug='cards')
		item = Item.objects.create(
			title='Override Pikachu',
			category=cards_category,
			tcg_set_name='Test Set',
			card_number='025',
			stock=1,
			price='4.00',
			is_active=True,
			published_at=timezone.now(),
		)
		mock_fetch.return_value = [
			{
				'api_id': 'sv-test-025',
				'name': 'Override Pikachu',
				'clean_name': 'Override Pikachu',
				'set_name': 'Test Set',
				'number': '025',
				'set_printed_total': '100',
				'regulation_mark': 'H',
				'standard_legal': True,
			}
		]

		response = client.post(
			'/api/inventory/admin/cards/sync-properties/',
			{'item_ids': [item.id], 'fields': ['standard_legal']},
			format='json',
		)

		self.assertEqual(response.status_code, 202)
		job = BackgroundJob.objects.get(id=response.json()['job_id'])
		mock_start_job.assert_called_once_with(str(job.id))

		from inventory.views import _run_card_property_sync_job
		_run_card_property_sync_job(str(job.id))

		item.refresh_from_db()
		self.assertFalse(item.standard_legal)

	@patch('inventory.management.commands.sync_tcg_prices.download_json')
	def test_sync_tcg_prices_imports_fallback_prices_and_card_numbers(self, mock_download_json):
		from inventory.management.commands.sync_tcg_prices import Command

		def fake_download(url, cache_path, force=False):
			if url.endswith('/products'):
				return {
					'results': [
						{
							'productId': 675992,
							'name': "Acerola's Mischief",
							'cleanName': 'Acerolas Mischief',
							'imageUrl': 'https://images.example.com/acerola.jpg',
							'url': 'https://www.tcgplayer.com/product/675992/pokemon-me-ascended-heroes-acerolas-mischief',
							'extendedData': [
								{'name': 'Number', 'value': '180/217'},
								{'name': 'Rarity', 'value': 'Uncommon'},
							],
						},
						{
							'productId': 675993,
							'name': 'Air Balloon',
							'cleanName': 'Air Balloon',
							'imageUrl': 'https://images.example.com/air-balloon.jpg',
							'url': 'https://www.tcgplayer.com/product/675993/pokemon-me-ascended-heroes-air-balloon',
							'extendedData': [{'name': 'Number', 'value': '181/217'}],
						},
					],
				}
			return {
				'results': [
					{
						'productId': 675992,
						'subTypeName': 'Normal',
						'marketPrice': None,
						'lowPrice': '1.23',
						'midPrice': '1.50',
						'highPrice': '2.00',
						'directLowPrice': '1.10',
					},
				],
			}

		mock_download_json.side_effect = fake_download

		count = Command()._process_group(24541, 'ME: Ascended Heroes', force=True)

		self.assertEqual(count, 2)
		priced_card = TCGCardPrice.objects.get(product_id=675992, sub_type_name='Normal')
		self.assertEqual(priced_card.market_price, Decimal('1.10'))
		self.assertEqual(priced_card.low_price, Decimal('1.23'))
		self.assertEqual(priced_card.price_source, 'direct_low')
		self.assertEqual(priced_card.card_number, '180')
		self.assertEqual(priced_card.set_printed_total, '217')
		self.assertEqual(priced_card.tcgplayer_url, 'https://www.tcgplayer.com/product/675992/pokemon-me-ascended-heroes-acerolas-mischief')
		metadata_only_card = TCGCardPrice.objects.get(product_id=675993, sub_type_name='Normal')
		self.assertIsNone(metadata_only_card.market_price)
		self.assertEqual(metadata_only_card.card_number, '181')

	@patch('inventory.views._requests.get')
	def test_tcg_sets_endpoint_falls_back_to_trade_database(self, mock_get):
		from .views import _SETS_CACHE
		_SETS_CACHE['data'] = None
		_SETS_CACHE['ts'] = 0.0
		TCGCardPrice.objects.create(
			product_id=101,
			name='Pikachu ex - 001/123',
			clean_name='Pikachu ex 001 123',
			group_id=77,
			group_name='SV3: Obsidian Flames',
			sub_type_name='Holofoil',
			rarity='Double Rare',
			market_price='3.00',
		)
		mock_get.side_effect = requests.exceptions.Timeout('timed out')

		response = self.client.get('/api/inventory/tcg-sets/')

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.json()['results'][0]['name'], 'Obsidian Flames')
		self.assertEqual(response.json()['results'][0]['series'], 'Trade Database')

	@patch('inventory.services.requests.get')
	def test_fetch_tcg_card_prefers_trade_database_price(self, mock_get):
		TCGCardPrice.objects.create(
			product_id=12345,
			name='Charizard ex - 125/230',
			clean_name='Charizard ex 125 230',
			group_id=501,
			group_name='SV3: Obsidian Flames',
			sub_type_name='Holofoil',
			rarity='Double Rare',
			market_price='5.26',
		)

		response = Mock()
		response.raise_for_status.return_value = None
		response.json.return_value = {
			'data': [
				{
					'id': 'sv3-125',
					'name': 'Charizard ex',
					'number': '125',
					'rarity': 'Double Rare',
					'types': ['Fire'],
					'subtypes': ['Basic', 'ex'],
					'supertype': 'Pokémon',
					'hp': '330',
					'artist': 'PLANETA Mochizuki',
					'images': {'small': 'https://example.com/small.png', 'large': 'https://example.com/large.png'},
					'set': {
						'id': 'sv3',
						'name': 'Obsidian Flames',
						'printedTotal': 230,
						'releaseDate': '2023/08/11',
					},
					'tcgplayer': {
						'url': 'https://www.tcgplayer.com/product/99999',
						'prices': {
							'holofoil': {'market': 4.1},
						},
					},
				},
			],
		}
		mock_get.return_value = response

		results = fetch_tcg_card('Charizard ex')

		self.assertEqual(len(results), 1)
		self.assertEqual(results[0]['market_price'], 5.26)
		self.assertEqual(results[0]['price_source'], 'Trade Database')
		self.assertEqual(results[0]['tcgplayer_url'], 'https://www.tcgplayer.com/product/12345')

	@patch('inventory.services.requests.get')
	def test_fetch_tcg_card_matches_tcgcsv_number_metadata(self, mock_get):
		TCGCardPrice.objects.create(
			product_id=675992,
			name="Acerola's Mischief",
			clean_name='Acerolas Mischief',
			group_id=24541,
			group_name='ME: Ascended Heroes',
			image_url='https://images.example.com/acerola.png',
			tcgplayer_url='https://www.tcgplayer.com/product/675992/pokemon-me-ascended-heroes-acerolas-mischief',
			card_number='180',
			set_printed_total='217',
			sub_type_name='Reverse Holofoil',
			rarity='Uncommon',
			market_price='0.24',
		)

		response = Mock()
		response.raise_for_status.return_value = None
		response.json.return_value = {
			'data': [
				{
					'id': 'me2pt5-180',
					'name': "Acerola's Mischief",
					'number': '180',
					'rarity': 'Uncommon',
					'types': [],
					'subtypes': ['Supporter'],
					'supertype': 'Trainer',
					'images': {'small': 'https://api.example.com/small.png', 'large': 'https://api.example.com/large.png'},
					'set': {
						'id': 'me2pt5',
						'name': 'Ascended Heroes',
						'printedTotal': 217,
					},
					'tcgplayer': {
						'url': 'https://prices.pokemontcg.io/tcgplayer/me2pt5-180',
						'prices': {},
					},
				},
			],
		}
		mock_get.return_value = response

		results = fetch_tcg_card('Acerola Mischief Ascended Heroes')

		self.assertEqual(len(results), 1)
		self.assertEqual(results[0]['product_id'], 675992)
		self.assertEqual(results[0]['market_price'], 0.24)
		self.assertEqual(results[0]['price_source'], 'Trade Database')
		self.assertEqual(results[0]['tcgplayer_url'], 'https://www.tcgplayer.com/product/675992/pokemon-me-ascended-heroes-acerolas-mischief')
		self.assertEqual(results[0]['tcg_price_sub_type'], 'Reverse Holofoil')

	@patch('inventory.services.requests.get')
	def test_fetch_tcg_card_matches_zero_padded_tcgcsv_number_metadata(self, mock_get):
		TCGCardPrice.objects.create(
			product_id=675813,
			name="Erika's Oddish",
			clean_name='Erikas Oddish',
			group_id=24541,
			group_name='ME: Ascended Heroes',
			image_url='https://images.example.com/oddish.png',
			tcgplayer_url='https://www.tcgplayer.com/product/675813/pokemon-me-ascended-heroes-erikas-oddish',
			card_number='001',
			set_printed_total='217',
			sub_type_name='Normal',
			rarity='Common',
			market_price='0.09',
		)

		response = Mock()
		response.raise_for_status.return_value = None
		response.json.return_value = {
			'data': [
				{
					'id': 'me2pt5-1',
					'name': "Erika's Oddish",
					'number': '1',
					'rarity': 'Common',
					'types': ['Grass'],
					'subtypes': ['Basic'],
					'supertype': 'Pokemon',
					'hp': '60',
					'images': {'small': 'https://api.example.com/small.png', 'large': 'https://api.example.com/large.png'},
					'set': {'id': 'me2pt5', 'name': 'Ascended Heroes', 'printedTotal': 217},
					'tcgplayer': {'url': 'https://prices.pokemontcg.io/tcgplayer/me2pt5-1', 'prices': {}},
				},
			],
		}
		mock_get.return_value = response

		results = fetch_tcg_card('Erika Oddish Ascended Heroes')

		self.assertEqual(len(results), 1)
		self.assertEqual(results[0]['product_id'], 675813)
		self.assertEqual(results[0]['market_price'], 0.09)
		self.assertEqual(results[0]['tcgplayer_url'], 'https://www.tcgplayer.com/product/675813/pokemon-me-ascended-heroes-erikas-oddish')
		self.assertEqual(results[0]['tcg_price_sub_type'], 'Normal')

	@patch('inventory.services.fetch_tcg_card')
	def test_tcg_import_returns_empty_results_when_upstream_unavailable(self, mock_fetch):
		cache.clear()
		admin_user = get_user_model().objects.create_user(
			email='tcg-import-admin@example.com',
			password='password123',
			is_staff=True,
		)
		client = APIClient()
		client.force_authenticate(admin_user)
		mock_fetch.side_effect = RuntimeError('Pokemon TCG API is temporarily unavailable')

		response = client.get('/api/inventory/tcg-import/', {'q': 'Acerola Mischief'})

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.json()['results'], [])

	@patch('inventory.services.requests.get')
	def test_fetch_tcg_card_falls_back_to_trade_database_when_api_unavailable(self, mock_get):
		TCGCardPrice.objects.create(
			product_id=675700,
			name='Meganium (10)',
			clean_name='Meganium 10',
			group_id=901,
			group_name='ME: Neo Genesis',
			image_url='https://images.example.com/meganium10.png',
			sub_type_name='Holofoil',
			rarity='Rare Holo',
			market_price='157.50',
		)
		TCGCardPrice.objects.create(
			product_id=675822,
			name='Mega Meganium ex - 010/217',
			clean_name='Mega Meganium ex 010 217',
			group_id=902,
			group_name='ME: Ascended Heroes',
			image_url='https://images.example.com/megameganium.png',
			sub_type_name='Holofoil',
			rarity='Double Rare',
			market_price='5.79',
		)
		TCGCardPrice.objects.create(
			product_id=675900,
			name='Ascended Heroes Mega Meganium ex Box',
			clean_name='Ascended Heroes Mega Meganium ex Box',
			group_id=903,
			group_name='ME: Ascended Heroes',
			image_url='https://images.example.com/box.png',
			sub_type_name='Normal',
			rarity='Promo',
			market_price='71.91',
		)

		mock_get.side_effect = requests.exceptions.Timeout('timed out')

		results = fetch_tcg_card('Mega Meganium')

		self.assertGreaterEqual(len(results), 1)
		self.assertEqual(results[0]['name'], 'Mega Meganium ex')
		self.assertEqual(results[0]['market_price'], 5.79)
		self.assertEqual(results[0]['price_source'], 'Trade Database (Fallback)')
		self.assertEqual(results[0]['tcgplayer_url'], 'https://www.tcgplayer.com/product/675822')
		self.assertEqual(results[0]['image_large'], 'https://images.example.com/megameganium.png')

	@patch('inventory.services.requests.get')
	def test_fetch_tcg_card_merges_local_keyword_matches_when_api_results_are_incomplete(self, mock_get):
		TCGCardPrice.objects.create(
			product_id=87291,
			name='Mega Meganium ex - 010/217',
			clean_name='Mega Meganium ex 010 217',
			group_id=902,
			group_name='ME: Ascended Heroes',
			image_url='https://images.example.com/megameganium.png',
			sub_type_name='Holofoil',
			rarity='Double Rare',
			market_price='5.79',
		)

		response = Mock()
		response.raise_for_status.return_value = None
		response.json.return_value = {
			'data': [
				{
					'id': 'neo1-10',
					'name': 'Meganium',
					'number': '10',
					'rarity': 'Rare Holo',
					'types': ['Grass'],
					'subtypes': ['Stage 2'],
					'supertype': 'Pokémon',
					'hp': '100',
					'artist': 'Ken Sugimori',
					'images': {'small': 'https://example.com/meganium-small.png', 'large': 'https://example.com/meganium-large.png'},
					'set': {
						'id': 'neo1',
						'name': 'Neo Genesis',
						'printedTotal': 111,
						'releaseDate': '2000/12/16',
					},
					'tcgplayer': {
						'url': 'https://www.tcgplayer.com/product/11111',
						'prices': {
							'holofoil': {'market': 82.5},
						},
					},
				},
			],
		}
		mock_get.return_value = response

		results = fetch_tcg_card('Meganium')

		self.assertTrue(any(result['name'] == 'Mega Meganium ex' for result in results))
		mega_result = next(result for result in results if result['name'] == 'Mega Meganium ex')
		self.assertEqual(mega_result['set_name'], 'Ascended Heroes')
		self.assertEqual(mega_result['number'], '010')
		self.assertEqual(mega_result['set_printed_total'], '217')
		self.assertEqual(mega_result['price_source'], 'Trade Database Search')

	@patch('inventory.services.requests.get')
	def test_trade_database_fallback_results_have_unique_ids_per_subtype(self, mock_get):
		TCGCardPrice.objects.create(
			product_id=87291,
			name='Mega Meganium ex - 010/217',
			clean_name='Mega Meganium ex 010 217',
			group_id=902,
			group_name='ME: Ascended Heroes',
			image_url='https://images.example.com/megameganium-holo.png',
			sub_type_name='Holofoil',
			rarity='Double Rare',
			market_price='5.79',
		)
		TCGCardPrice.objects.create(
			product_id=87291,
			name='Mega Meganium ex - 010/217',
			clean_name='Mega Meganium ex 010 217',
			group_id=902,
			group_name='ME: Ascended Heroes',
			image_url='https://images.example.com/megameganium-reverse.png',
			sub_type_name='Reverse Holofoil',
			rarity='Double Rare',
			market_price='5.49',
		)

		mock_get.side_effect = requests.exceptions.Timeout('timed out')

		results = fetch_tcg_card('Mega Meganium')
		api_ids = [result['api_id'] for result in results]

		self.assertEqual(len(api_ids), len(set(api_ids)))
		self.assertIn('trade-87291-holofoil', api_ids)
		self.assertIn('trade-87291-reverseholofoil', api_ids)

	@patch('inventory.services.requests.get')
	def test_fetch_tcg_card_uses_broader_upstream_keyword_query(self, mock_get):
		response = Mock()
		response.raise_for_status.return_value = None
		response.json.return_value = {'data': []}
		mock_get.return_value = response

		fetch_tcg_card('Meganium 010/217')

		self.assertTrue(mock_get.called)
		self.assertEqual(mock_get.call_args.kwargs['params']['pageSize'], 50)
		self.assertIn('name:*meganium*', mock_get.call_args.kwargs['params']['q'])
		self.assertIn('number:010', mock_get.call_args.kwargs['params']['q'])
		self.assertIn('set.printedTotal:[217 TO 217]', mock_get.call_args.kwargs['params']['q'])

	def test_card_market_price_rounding_uses_sub_dollar_tiers(self):
		from .views import _round_card_market_price

		self.assertEqual(_round_card_market_price(Decimal('0.99')), Decimal('0.75'))
		self.assertEqual(_round_card_market_price(Decimal('0.65')), Decimal('0.75'))
		self.assertEqual(_round_card_market_price(Decimal('0.64')), Decimal('0.50'))
		self.assertEqual(_round_card_market_price(Decimal('0.30')), Decimal('0.50'))
		self.assertEqual(_round_card_market_price(Decimal('0.29')), Decimal('0.25'))
		self.assertEqual(_round_card_market_price(Decimal('1.24')), Decimal('1.00'))
		self.assertEqual(_round_card_market_price(Decimal('1.25')), Decimal('1.50'))
		self.assertEqual(_round_card_market_price(Decimal('1.37')), Decimal('1.50'))
		self.assertEqual(_round_card_market_price(Decimal('1.74')), Decimal('1.50'))
		self.assertEqual(_round_card_market_price(Decimal('1.75')), Decimal('2.00'))


class SubCategoryApiTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		self.admin_user = get_user_model().objects.create_user(
			email='subcategory-admin@example.com',
			password='password123',
			is_staff=True,
		)
		self.client.force_authenticate(self.admin_user)
		self.category = Category.objects.create(name='Supplies', slug='supplies')

	def test_admin_can_create_subcategory_with_category_id(self):
		response = self.client.post(
			'/api/inventory/subcategories/',
			{
				'category': self.category.id,
				'name': 'Deck Boxes',
				'slug': 'deck-boxes',
			},
			format='json',
		)

		self.assertEqual(response.status_code, 201)
		self.assertTrue(self.category.subcategories.filter(slug='deck-boxes').exists())
