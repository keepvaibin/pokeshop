import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.conf import settings
from django.utils import timezone


class Order(models.Model):
    PAYMENT_CHOICES = [
        ('venmo', 'Venmo'),
        ('zelle', 'Zelle'),
        ('paypal', 'PayPal'),
        ('cash', 'Cash'),
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
    ACTIVE_ORDER_STATUSES = ('pending', 'trade_review', 'pending_counteroffer', 'cash_needed')
    ACTIVE_SLOT_STATUSES = ACTIVE_ORDER_STATUSES

    order_id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE, null=True, blank=True)
    quantity = models.PositiveIntegerField(null=True, blank=True)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_CHOICES)
    delivery_method = models.CharField(max_length=10, choices=DELIVERY_CHOICES)
    pickup_slot = models.ForeignKey('inventory.PickupSlot', on_delete=models.SET_NULL, null=True, blank=True)
    pickup_timeslot = models.ForeignKey('inventory.PickupTimeslot', on_delete=models.SET_NULL, null=True, blank=True)
    discord_handle = models.CharField(max_length=100)
    status = models.CharField(max_length=25, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    preferred_pickup_time = models.CharField(max_length=255, blank=True, null=True)

    # Single-card trade fields (for historical orders only)
    trade_card_name = models.CharField(max_length=100, null=True, blank=True)
    trade_card_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    buy_if_trade_denied = models.BooleanField(default=False)

    # Trade overage: amount the shop owes the user when trade credit > order total
    trade_overage = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Snapshot of trade credit actually applied to this order's total.
    trade_credit_applied = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Backup payment method for partial-trade orders
    backup_payment_method = models.CharField(max_length=20, blank=True, default='')

    # Recurring timeslot support
    recurring_timeslot = models.ForeignKey('inventory.RecurringTimeslot', on_delete=models.SET_NULL, null=True, blank=True)
    pickup_date = models.DateField(null=True, blank=True, help_text="Specific date this recurring slot is booked for")

    # Cancellation tracking
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='orders_cancelled',
    )
    cancellation_penalty = models.BooleanField(default=False)

    # Rescheduling - set when admin deletes a booked timeslot
    requires_rescheduling = models.BooleanField(default=False)
    pickup_rescheduled_by_user = models.BooleanField(default=False, help_text="True once the user uses their one-time voluntary reschedule")
    reschedule_deadline = models.DateTimeField(null=True, blank=True)

    # Counteroffer
    counteroffer_message = models.TextField(blank=True, default='', help_text="Admin message explaining the counteroffer to the user")
    counteroffer_expires_at = models.DateTimeField(null=True, blank=True, help_text="When the counteroffer auto-expires")

    # Resolution timeline - append-only list of {timestamp, event, detail}
    resolution_summary = models.JSONField(default=list, blank=True, help_text="Chronological event log for order timeline")
    is_acknowledged = models.BooleanField(default=False, help_text="Whether an ASAP order has been acknowledged by an admin")
    asap_reminder_level = models.PositiveSmallIntegerField(default=0, help_text="Highest automated admin reminder sent for this ASAP order")

    # Coupon
    coupon_code = models.CharField(max_length=50, blank=True, default='')
    discount_applied = models.DecimalField(max_digits=10, decimal_places=2, default=0, help_text="Dollar amount discounted by coupon")

    # Admin POS: who created this order on behalf of the customer (null = customer placed it themselves)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_orders',
        help_text="Admin who created this order on behalf of the user",
    )

    def __str__(self):
        user_email = self.user.email if self.user else 'deleted-user'
        items = self.order_items.select_related('item').all()
        if items:
            names = ', '.join(f'{oi.item.title} x{oi.quantity}' for oi in items)
            return f"Order {self.order_id} - {user_email} - {names}"
        return f"Order {self.order_id} - {user_email}"


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='order_items')
    item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField()
    price_at_purchase = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"{self.item.title} x{self.quantity}"


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
        return f"TradeOffer for Order #{self.order_id} - ${self.total_credit}"


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
    rarity = models.CharField(max_length=100, blank=True, default='')
    photo = models.ImageField(upload_to='trade_photos/', blank=True)
    is_wanted_card = models.BooleanField(default=False, help_text="True if this matches a card on our Wanted list")
    approved = models.BooleanField(null=True, default=None, help_text="Null=pending, True=accepted, False=denied")
    is_accepted = models.BooleanField(null=True, default=None, help_text="Per-card accept/reject for partial trades. Null=pending, True=accepted, False=rejected")
    # TCG oracle fields - populated when user selects from autocomplete
    tcg_product_id = models.IntegerField(null=True, blank=True, help_text="TCGCSV product ID for oracle price lookup")
    tcg_sub_type = models.CharField(max_length=80, blank=True, default='', help_text="e.g. Normal, Holofoil")
    base_market_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Oracle base market price at time of checkout")
    custom_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="User-provided expected value override")
    admin_override_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Admin-overridden trade credit value (replaces calculated credit)")

    def __str__(self):
        return f"{self.card_name} (${self.estimated_value})"


class Coupon(models.Model):
    code = models.CharField(max_length=50, unique=True)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Flat dollar discount")
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True, help_text="Percentage discount (0-100)")
    usage_limit = models.PositiveIntegerField(default=0, help_text="0 = unlimited")
    times_used = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    min_order_total = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Minimum cash total (after trade credit) required")
    specific_products = models.ManyToManyField('inventory.Item', blank=True, help_text="If set, discount applies only to these products")
    requires_cash_only = models.BooleanField(default=False, help_text="If True, any trade credit disqualifies this coupon")

    def clean(self):
        super().clean()
        has_amount = self.discount_amount is not None and self.discount_amount > 0
        has_percent = self.discount_percent is not None and self.discount_percent > 0
        if has_amount and has_percent:
            raise ValidationError('Set only one of discount_amount or discount_percent, not both.')
        if not has_amount and not has_percent:
            raise ValidationError('Set either discount_amount or discount_percent.')
        if has_percent and self.discount_percent > 100:
            raise ValidationError('discount_percent cannot exceed 100.')

    @property
    def is_valid(self):
        if not self.is_active:
            return False
        if self.usage_limit > 0 and self.times_used >= self.usage_limit:
            return False
        if self.expires_at and timezone.now() >= self.expires_at:
            return False
        return True

    def __str__(self):
        if self.discount_amount:
            return f"{self.code} - ${self.discount_amount} off"
        return f"{self.code} - {self.discount_percent}% off"


class SupportTicket(models.Model):
    STATUS_CHOICES = [
        ('open', 'Open'),
        ('closed', 'Closed'),
    ]

    ticket_id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='support_tickets')
    order = models.ForeignKey(Order, on_delete=models.SET_NULL, null=True, blank=True, related_name='support_tickets')
    discord_user_id = models.CharField(max_length=32, db_index=True)
    discord_channel_id = models.CharField(max_length=32, unique=True)
    subject = models.CharField(max_length=200)
    initial_message = models.TextField(blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"SupportTicket {self.ticket_id} - {self.subject}"


class CartItem(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cart_items')
    item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField(default=1)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'item')
        ordering = ['-added_at']

    def __str__(self):
        return f"{self.user.email} - {self.item.title} x{self.quantity}"
