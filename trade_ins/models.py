"""Trade-In and Store-Credit models.

A `TradeInRequest` is the customer-submitted intent to trade cards in
exchange for store credit. It contains many `TradeInItem` line items (the
cards themselves). When an admin reviews and completes the request, the
final payout amount is added to the user's `UserProfile.trade_credit_balance`
and a `CreditLedger` row is written for full audit history.

The wallet balance is the SUM of all `CreditLedger.amount` entries for the
user (positive = credit, negative = spend). The `UserProfile` field is a
denormalized cache of that sum for fast lookups; it is updated atomically
inside the same transaction that creates each ledger row.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models


class TradeInRequest(models.Model):
    STATUS_PENDING_REVIEW = 'pending_review'
    STATUS_PENDING_COUNTEROFFER = 'pending_counteroffer'
    STATUS_APPROVED_PENDING_RECEIPT = 'approved_pending_receipt'
    STATUS_COMPLETED = 'completed'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_PENDING_REVIEW, 'Pending Review'),
        (STATUS_PENDING_COUNTEROFFER, 'Counteroffer Pending'),
        (STATUS_APPROVED_PENDING_RECEIPT, 'Approved - Awaiting Cards'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    ACTIVE_PICKUP_STATUSES = (
        STATUS_PENDING_REVIEW,
        STATUS_PENDING_COUNTEROFFER,
        STATUS_APPROVED_PENDING_RECEIPT,
    )

    SUBMISSION_CHOICES = [
        ('in_store_dropoff', 'Drop-Off'),
    ]

    PAYOUT_TYPE_STORE_CREDIT = 'store_credit'
    PAYOUT_TYPE_CASH = 'cash'
    PAYOUT_TYPE_CHOICES = [
        (PAYOUT_TYPE_STORE_CREDIT, 'Store Credit'),
        (PAYOUT_TYPE_CASH, 'Cash'),
    ]

    CASH_PAYOUT_METHOD_CHOICES = [
        ('venmo', 'Venmo'),
        ('zelle', 'Zelle'),
        ('paypal', 'PayPal'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='trade_in_requests',
    )
    status = models.CharField(
        max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING_REVIEW, db_index=True
    )
    submission_method = models.CharField(max_length=32, choices=SUBMISSION_CHOICES)
    payout_type = models.CharField(
        max_length=20,
        choices=PAYOUT_TYPE_CHOICES,
        default=PAYOUT_TYPE_STORE_CREDIT,
    )
    cash_payment_method = models.CharField(
        max_length=20,
        choices=CASH_PAYOUT_METHOD_CHOICES,
        blank=True,
        default='',
    )
    recurring_timeslot = models.ForeignKey(
        'inventory.RecurringTimeslot',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='trade_in_requests',
    )
    pickup_date = models.DateField(null=True, blank=True)
    estimated_total_value = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0')
    )
    credit_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('85.00')
    )
    final_payout_value = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    counteroffer_message = models.TextField(blank=True, default='')
    counteroffer_expires_at = models.DateTimeField(null=True, blank=True)
    customer_notes = models.TextField(blank=True, default='')
    admin_notes = models.TextField(blank=True, default='')
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='trade_ins_reviewed',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"TradeIn #{self.pk} ({self.user.email} - {self.status})"


class TradeInItem(models.Model):
    CONDITION_CHOICES = [
        ('NM', 'Near Mint'),
        ('LP', 'Lightly Played'),
        ('MP', 'Moderately Played'),
        ('HP', 'Heavily Played'),
        ('DMG', 'Damaged'),
    ]

    request = models.ForeignKey(
        TradeInRequest, on_delete=models.CASCADE, related_name='items'
    )
    card_name = models.CharField(max_length=200)
    set_name = models.CharField(max_length=200, blank=True, default='')
    card_number = models.CharField(max_length=32, blank=True, default='')
    condition = models.CharField(max_length=8, choices=CONDITION_CHOICES, default='NM')
    quantity = models.PositiveIntegerField(default=1)
    user_estimated_price = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0')
    )
    image_url = models.URLField(max_length=500, blank=True, default='')
    tcg_product_id = models.IntegerField(null=True, blank=True)
    tcg_sub_type = models.CharField(max_length=80, blank=True, default='')
    base_market_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    tcgplayer_url = models.URLField(max_length=500, blank=True, default='')
    is_accepted = models.BooleanField(null=True, default=None)
    admin_override_value = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )

    def __str__(self):
        return f"{self.quantity}x {self.card_name} ({self.condition})"


class CreditLedger(models.Model):
    """Append-only ledger of every wallet credit movement.

    Positive `amount` = credit added (trade-in payout, admin top-up).
    Negative `amount` = credit spent (order purchase, admin debit).
    The `reference_id` is a free-form string identifying the source row
    (e.g. trade_in:42, order:<uuid>, manual:<note>).
    """
    TYPE_TRADE_IN_PAYOUT = 'trade_in_payout'
    TYPE_ORDER_PURCHASE = 'order_purchase'
    TYPE_ORDER_REFUND = 'order_refund'
    TYPE_ADMIN_ADJUSTMENT = 'admin_adjustment'

    TYPE_CHOICES = [
        (TYPE_TRADE_IN_PAYOUT, 'Trade-In Payout'),
        (TYPE_ORDER_PURCHASE, 'Order Purchase'),
        (TYPE_ORDER_REFUND, 'Order Refund'),
        (TYPE_ADMIN_ADJUSTMENT, 'Admin Adjustment'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='credit_ledger',
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    transaction_type = models.CharField(max_length=32, choices=TYPE_CHOICES, db_index=True)
    reference_id = models.CharField(max_length=128, blank=True, default='', db_index=True)
    note = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='credit_ledger_entries_created',
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.email} {self.amount:+} ({self.transaction_type})"
