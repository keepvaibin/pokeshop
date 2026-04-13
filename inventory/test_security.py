from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from inventory.models import Item, PokeshopSettings


User = get_user_model()


class InventorySecurityTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email='inventory-security@example.com',
            password='password123',
            is_staff=True,
        )
        self.client.force_authenticate(self.admin)

    def test_item_plain_text_fields_are_sanitized(self):
        response = self.client.post(
            '/api/inventory/items/',
            {
                'title': '<b>Binder</b>',
                'short_description': '<script>alert(1)</script> Premium storage',
                'image_path': '/images/binder.jpg',
                'price': '19.99',
                'stock': 3,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        item = Item.objects.get(slug=response.data['slug'])
        self.assertEqual(item.title, 'Binder')
        self.assertEqual(item.short_description, 'alert(1) Premium storage')

    def test_settings_announcement_is_sanitized(self):
        response = self.client.patch(
            '/api/inventory/settings/1/',
            {
                'store_announcement': '<b>Campus pickup only</b>',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['store_announcement'], 'Campus pickup only')
        self.assertEqual(PokeshopSettings.load().store_announcement, 'Campus pickup only')

    def test_promo_banner_rejects_javascript_link_urls(self):
        response = self.client.post(
            '/api/inventory/promo-banners/',
            {
                'title': 'Promo Banner',
                'subtitle': 'Fresh drops',
                'image_url': 'https://images.example.com/banner.jpg',
                'link_url': 'javascript:alert(1)',
                'size': 'QUARTER',
                'position_order': 1,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('link_url', response.data)