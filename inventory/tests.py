from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
import requests
from rest_framework.test import APIClient
from unittest.mock import Mock, patch

from .models import AccessCode, Category, Item, ItemTag, PokeshopSettings, RecurringTimeslot
from .models import TCGCardPrice, WantedCard, WantedCardImage
from .services import fetch_tcg_card
from orders.models import Order


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

	def test_public_recurring_timeslots_batch_booking_counts(self):
		pickup_date = timezone.localdate()
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

		with CaptureQueriesContext(connection) as queries:
			response = self.client.get('/api/inventory/recurring-timeslots/')

		self.assertEqual(response.status_code, 200)
		self.assertLessEqual(len(queries), 4)


class WantedCardApiPerformanceTests(TestCase):
	def setUp(self):
		self.client = APIClient()

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
