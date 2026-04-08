from django.db import models
from django.conf import settings

class Order(models.Model):
    PAYMENT_CHOICES = [
        ('venmo', 'Venmo'),
        ('zelle', 'Zelle'),
        ('paypal', 'PayPal'),
        ('trade', 'Trade-In'),
    ]
    DELIVERY_CHOICES = [
        ('scheduled', 'Scheduled Campus Pickup'),
        ('asap', 'ASAP Downtown Pickup'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('fulfilled', 'Fulfilled'),
        ('cancelled', 'Cancelled'),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField()
    payment_method = models.CharField(max_length=10, choices=PAYMENT_CHOICES)
    delivery_method = models.CharField(max_length=10, choices=DELIVERY_CHOICES)
    pickup_slot = models.ForeignKey('inventory.PickupSlot', on_delete=models.SET_NULL, null=True, blank=True)
    discord_handle = models.CharField(max_length=100)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Trade-in fields
    trade_card_name = models.CharField(max_length=100, null=True, blank=True)
    trade_card_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    def __str__(self):
        return f"Order {self.id} - {self.user.email} - {self.item.title}"
