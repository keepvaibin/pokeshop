from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core import signing
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from inventory.models import Item
from orders.models import Order, OrderItem

from .models import PokemonIcon, Strike, UserProfile


@override_settings(
	DISCORD_CLIENT_ID='discord-client-id',
	DISCORD_CLIENT_SECRET='discord-client-secret',
	DISCORD_OAUTH_REDIRECT_URI='http://localhost:8000/api/auth/discord/callback/',
	FRONTEND_URL='http://localhost:3000',
)
class DiscordOAuthTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		self.user = get_user_model().objects.create_user(email='member@example.com', password='password123')
		self.profile = UserProfile.objects.create(user=self.user, discord_handle='legacy-name')

	def test_initiate_returns_discord_authorization_url(self):
		self.client.force_authenticate(self.user)

		response = self.client.get('/api/auth/discord/initiate/', {'next': '/settings'})

		self.assertEqual(response.status_code, 200)
		self.assertIn('discord.com/oauth2/authorize', response.data['authorization_url'])
		self.assertIn('client_id=discord-client-id', response.data['authorization_url'])

	@patch('users.views.requests.get')
	@patch('users.views.requests.post')
	def test_callback_links_discord_id_to_profile(self, mock_post, mock_get):
		token_response = Mock()
		token_response.raise_for_status.return_value = None
		token_response.json.return_value = {'access_token': 'discord-access-token'}
		mock_post.return_value = token_response

		user_response = Mock()
		user_response.raise_for_status.return_value = None
		user_response.json.return_value = {
			'id': '123456789012345678',
			'username': 'slugfan',
			'global_name': 'Slug Fan',
			'discriminator': '0',
		}
		mock_get.return_value = user_response

		state = signing.dumps({'user_id': self.user.id, 'next': '/settings'}, salt='discord-oauth-state')

		response = self.client.get('/api/auth/discord/callback/', {'code': 'oauth-code', 'state': state})

		self.assertEqual(response.status_code, 302)
		self.assertEqual(response.url, 'http://localhost:3000/settings?discord=linked')
		self.profile.refresh_from_db()
		self.assertEqual(self.profile.discord_id, '123456789012345678')
		self.assertEqual(self.profile.discord_handle, 'Slug Fan')
		self.assertFalse(self.profile.no_discord)

	def test_profile_patch_marking_no_discord_clears_existing_link(self):
		self.client.force_authenticate(self.user)
		self.profile.discord_id = '123456789012345678'
		self.profile.discord_handle = 'Slug Fan'
		self.profile.no_discord = False
		self.profile.save(update_fields=['discord_id', 'discord_handle', 'no_discord'])

		response = self.client.patch('/api/auth/profile/', {'no_discord': True}, format='json')

		self.assertEqual(response.status_code, 200)
		self.profile.refresh_from_db()
		self.assertIsNone(self.profile.discord_id)
		self.assertEqual(self.profile.discord_handle, '')
		self.assertTrue(self.profile.no_discord)

	def test_profile_patch_disconnect_discord_clears_existing_link_without_no_discord(self):
		self.client.force_authenticate(self.user)
		self.profile.discord_id = '123456789012345678'
		self.profile.discord_handle = 'Slug Fan'
		self.profile.no_discord = True
		self.profile.save(update_fields=['discord_id', 'discord_handle', 'no_discord'])

		response = self.client.patch('/api/auth/profile/', {'disconnect_discord': True}, format='json')

		self.assertEqual(response.status_code, 200)
		self.profile.refresh_from_db()
		self.assertIsNone(self.profile.discord_id)
		self.assertEqual(self.profile.discord_handle, '')
		self.assertFalse(self.profile.no_discord)


class AdminUsersApiTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		User = get_user_model()
		self.admin = User.objects.create_user(
			email='admin@example.com',
			username='admin',
			is_admin=True,
		)
		self.user = User.objects.create_user(
			email='member@example.com',
			username='member',
		)
		self.icon = PokemonIcon.objects.create(
			pokedex_number=25,
			display_name='Pikachu',
			region='Kanto',
			filename='025-pikachu.png',
		)
		self.profile = UserProfile.objects.create(
			user=self.user,
			first_name='Ash',
			last_name='Ketchum',
			nickname='Champion',
			discord_id='123456789012345678',
			discord_handle='slugfan',
			trade_credit_balance='7.50',
			pokemon_icon=self.icon,
		)
		self.item = Item.objects.create(title='Admin Users Test Card', price='4.25', stock=10)
		self.current_order = Order.objects.create(
			user=self.user,
			payment_method='venmo',
			delivery_method='asap',
			discord_handle='',
			status='pending',
		)
		OrderItem.objects.create(
			order=self.current_order,
			item=self.item,
			quantity=2,
			price_at_purchase='4.25',
		)
		self.fulfilled_order = Order.objects.create(
			user=self.user,
			payment_method='cash',
			delivery_method='asap',
			discord_handle='',
			status='fulfilled',
		)
		OrderItem.objects.create(
			order=self.fulfilled_order,
			item=self.item,
			quantity=1,
			price_at_purchase='4.25',
		)
		self.strike = Strike.objects.create(
			user=self.user,
			reason='Missed pickup window',
			given_by=self.admin,
		)

	def test_admin_users_list_searches_profile_and_discord_fields(self):
		self.client.force_authenticate(self.admin)

		response = self.client.get('/api/auth/admin/users/', {'search': 'slugfan'})

		self.assertEqual(response.status_code, status.HTTP_200_OK)
		self.assertEqual(response.data['count'], 1)
		payload = response.data['results'][0]
		self.assertEqual(payload['email'], 'member@example.com')
		self.assertEqual(payload['display_name'], 'Champion')
		self.assertEqual(payload['pokemon_icon_filename'], '025-pikachu.png')
		self.assertEqual(payload['strike_count'], 1)
		self.assertEqual(payload['recent_order_count'], 2)
		self.assertEqual(payload['current_order_count'], 1)

	def test_admin_user_detail_includes_orders_strikes_and_credit(self):
		self.client.force_authenticate(self.admin)

		response = self.client.get(f'/api/auth/admin/users/{self.user.id}/')

		self.assertEqual(response.status_code, status.HTTP_200_OK)
		self.assertEqual(response.data['user']['trade_credit_balance'], '7.50')
		self.assertEqual(response.data['user']['discord_handle'], 'slugfan')
		self.assertEqual(len(response.data['recent_orders']), 2)
		self.assertEqual(len(response.data['current_orders']), 1)
		self.assertEqual(response.data['current_orders'][0]['items_summary'], 'Admin Users Test Card x2')
		self.assertEqual(response.data['strikes'][0]['reason'], 'Missed pickup window')
		self.assertEqual(response.data['strikes'][0]['given_by_email'], 'admin@example.com')

	def test_non_admin_cannot_list_admin_users(self):
		self.client.force_authenticate(self.user)

		response = self.client.get('/api/auth/admin/users/')

		self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
