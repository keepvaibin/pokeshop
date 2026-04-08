from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from inventory.models import Item
from orders.models import Order

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
