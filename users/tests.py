from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core import signing
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import UserProfile


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
