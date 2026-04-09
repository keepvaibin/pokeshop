import uuid

from django.db import models
from django.conf import settings


class Order(models.Model):
    PAYMENT_CHOICES = [
        ('venmo', 'Venmo'),
        ('zelle', 'Zelle'),
        ('paypal', 'PayPal'),
        ('trade', 'Trade-In'),
        ('cash_plus_trade', 'Cash + Trade Difference'),
    ]
    DELIVERY_CHOICES = [
        ('scheduled', 'Scheduled Campus Pickup'),
        ('asap', 'ASAP Downtown Pickup'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('fulfilled', 'Fulfilled'),
        ('cancelled', 'Cancelled'),
        ('cash_needed', 'Cash Payment Needed'),
        ('trade_review', 'Trade Under Review'),
        ('pending_counteroffer', 'Counteroffer Pending'),
    ]

    order_id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField()
    payment_method = models.CharField(max_length=20, choices=PAYMENT_CHOICES)
    delivery_method = models.CharField(max_length=10, choices=DELIVERY_CHOICES)
    pickup_slot = models.ForeignKey('inventory.PickupSlot', on_delete=models.SET_NULL, null=True, blank=True)
    pickup_timeslot = models.ForeignKey('inventory.PickupTimeslot', on_delete=models.SET_NULL, null=True, blank=True)
    discord_handle = models.CharField(max_length=100)
    status = models.CharField(max_length=25, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    preferred_pickup_time = models.CharField(max_length=255, blank=True, null=True)

    # Legacy single-card trade fields (kept for backward compat)
    trade_card_name = models.CharField(max_length=100, null=True, blank=True)
    trade_card_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    buy_if_trade_denied = models.BooleanField(default=False)

    # Trade overage: amount the shop owes the user when trade credit > order total
    trade_overage = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Backup payment method for partial-trade orders
    backup_payment_method = models.CharField(max_length=20, blank=True, default='')

    # Recurring timeslot support
    recurring_timeslot = models.ForeignKey('inventory.RecurringTimeslot', on_delete=models.SET_NULL, null=True, blank=True)
    pickup_date = models.DateField(null=True, blank=True, help_text="Specific date this recurring slot is booked for")

    # Cancellation tracking
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_penalty = models.BooleanField(default=False)

    # Rescheduling — set when admin deletes a booked timeslot
    requires_rescheduling = models.BooleanField(default=False)
    reschedule_deadline = models.DateTimeField(null=True, blank=True)

    # Counteroffer
    counteroffer_message = models.TextField(blank=True, default='', help_text="Admin message explaining the counteroffer to the user")

    def __str__(self):
        return f"Order {self.order_id} - {self.user.email} - {self.item.title}"


class TradeOffer(models.Model):
    """Groups all trade-in cards for a single order."""
    TRADE_MODE_CHOICES = [
        ('all_or_nothing', 'All or Nothing'),
        ('allow_partial', 'Allow Partial'),
    ]

    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name='trade_offer')
    total_credit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    credit_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=85.00)
    trade_mode = models.CharField(max_length=20, choices=TRADE_MODE_CHOICES, default='all_or_nothing')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"TradeOffer for Order #{self.order_id} — ${self.total_credit}"


class TradeCardItem(models.Model):
    CONDITION_CHOICES = [
        ('near_mint', 'Near Mint'),
        ('lightly_played', 'Lightly Played'),
        ('moderately_played', 'Moderately Played'),
        ('heavily_played', 'Heavily Played'),
        ('damaged', 'Damaged'),
    ]
    RARITY_CHOICES = [
        ('common', 'Common'),
        ('uncommon', 'Uncommon'),
        ('rare', 'Rare'),
        ('ultra_rare', 'Ultra Rare'),
        ('secret_rare', 'Secret Rare'),
    ]

    trade_offer = models.ForeignKey(TradeOffer, on_delete=models.CASCADE, related_name='cards')
    card_name = models.CharField(max_length=200)
    estimated_value = models.DecimalField(max_digits=10, decimal_places=2)
    condition = models.CharField(max_length=20, choices=CONDITION_CHOICES, default='lightly_played')
    rarity = models.CharField(max_length=20, choices=RARITY_CHOICES, blank=True, default='')
    photo = models.ImageField(upload_to='trade_photos/', blank=True)
    is_wanted_card = models.BooleanField(default=False, help_text="True if this matches a card on our Wanted list")
    approved = models.BooleanField(null=True, default=None, help_text="Null=pending, True=accepted, False=denied")
    is_accepted = models.BooleanField(null=True, default=None, help_text="Per-card accept/reject for partial trades. Null=pending, True=accepted, False=rejected")
    # TCG oracle fields — populated when user selects from autocomplete
    tcg_product_id = models.IntegerField(null=True, blank=True, help_text="TCGCSV product ID for oracle price lookup")
    tcg_sub_type = models.CharField(max_length=80, blank=True, default='', help_text="e.g. Normal, Holofoil")
    base_market_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Oracle base market price at time of checkout")
    custom_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="User-provided expected value override")
    admin_override_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Admin-overridden trade credit value (replaces calculated credit)")

    def __str__(self):
        return f"{self.card_name} (${self.estimated_value})"
