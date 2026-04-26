import uuid

from decimal import Decimal
from rest_framework import serializers
from .models import Order, OrderItem, TradeOffer, TradeCardItem, Coupon, SupportTicket, CartItem
from inventory.trade_utils import calc_trade_credit
from inventory.models import Item
from pokeshop.input_safety import (
    sanitize_json_payload,
    sanitize_plain_text,
    validate_compact_identifier,
    validate_discord_snowflake,
)


PAYMENT_MINIMUMS = {
    'zelle': Decimal('5.00'),
    'venmo': Decimal('1.00'),
    'paypal': Decimal('1.00'),
}


def _compute_checkout_items_total(items):
    item_ids = [entry['item_id'] for entry in items]
    prices_by_id = {
        item.id: item.price
        for item in Item.objects.filter(id__in=item_ids)
    }

    total = Decimal('0.00')
    for entry in items:
        price = prices_by_id.get(entry['item_id'])
        if price is None:
            continue
        total += price * entry['quantity']
    return total


def _validate_payment_minimum(payment_method, amount_due):
    minimum = PAYMENT_MINIMUMS.get(payment_method)
    if minimum is None:
        return
    if amount_due > Decimal('0') and amount_due < minimum:
        raise serializers.ValidationError(
            {'payment_method': f'{payment_method.upper()} requires at least ${minimum:.2f}. Current amount due is ${amount_due:.2f}.'}
        )


class TradeCardItemSerializer(serializers.ModelSerializer):
    # Derived boolean states for clear frontend consumption
    is_countered = serializers.SerializerMethodField()
    is_rejected = serializers.SerializerMethodField()
    # Original system-computed 85% credit (before any admin override)
    computed_credit = serializers.SerializerMethodField()

    class Meta:
        model = TradeCardItem
        fields = [
            'id', 'card_name', 'estimated_value', 'condition', 'rarity',
            'photo', 'is_wanted_card', 'approved', 'is_accepted',
            'tcg_product_id', 'tcg_sub_type', 'base_market_price',
            'custom_price', 'admin_override_value',
            # Derived states
            'is_countered', 'is_rejected', 'computed_credit',
        ]
        read_only_fields = ['approved', 'is_accepted', 'admin_override_value']

    def get_is_countered(self, obj) -> bool:
        """True when this card was accepted but with an admin price override."""
        return obj.is_accepted is True and obj.admin_override_value is not None

    def get_is_rejected(self, obj) -> bool:
        """True when this card was explicitly rejected."""
        return obj.is_accepted is False

    def get_computed_credit(self, obj) -> str | None:
        """The original system-computed trade credit before any admin override."""
        try:
            credit_pct = Decimal(str(obj.trade_offer.credit_percentage))
        except AttributeError:
            credit_pct = Decimal('85.00')
        if obj.base_market_price:
            return str(calc_trade_credit(obj.base_market_price, obj.condition, credit_pct))
        # Fall back to user-estimated value * credit_pct
        if obj.estimated_value:
            return str((obj.estimated_value * (credit_pct / Decimal('100'))).quantize(Decimal('0.01')))
        return None


class TradeOfferSerializer(serializers.ModelSerializer):
    cards = TradeCardItemSerializer(many=True, read_only=True)

    class Meta:
        model = TradeOffer
        fields = ['id', 'total_credit', 'credit_percentage', 'trade_mode', 'cards', 'created_at']


class OrderItemSerializer(serializers.ModelSerializer):
    item_title = serializers.CharField(source='item.title', read_only=True)
    item_price = serializers.DecimalField(source='price_at_purchase', max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = OrderItem
        fields = ['id', 'item', 'item_title', 'item_price', 'quantity', 'price_at_purchase']


class OrderSerializer(serializers.ModelSerializer):
    order_items = OrderItemSerializer(many=True, read_only=True)
    item_title = serializers.SerializerMethodField()
    item_price = serializers.SerializerMethodField()
    trade_offer = TradeOfferSerializer(read_only=True)
    user_email = serializers.EmailField(source='user.email', read_only=True)
    user_icon = serializers.SerializerMethodField()
    pickup_timeslot = serializers.SerializerMethodField()
    recurring_timeslot = serializers.SerializerMethodField()
    delivery_details = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = '__all__'
        read_only_fields = (
            'user', 'status', 'created_at', 'order_id',
            'trade_overage', 'discount_applied', 'cancellation_penalty',
            'cancelled_at', 'requires_rescheduling', 'reschedule_deadline',
            'resolution_summary', 'counteroffer_expires_at', 'is_acknowledged', 'asap_reminder_level',
        )

    def get_item_title(self, obj):
        items = obj.order_items.all()
        if items:
            return ', '.join(oi.item.title for oi in items)
        return obj.item.title if obj.item else ''

    def get_item_price(self, obj):
        items = list(obj.order_items.all())
        if items:
            if len(items) == 1:
                return str(items[0].price_at_purchase)
            return str(sum(oi.price_at_purchase * oi.quantity for oi in items))
        return str(obj.item.price) if obj.item else '0.00'

    def get_user_icon(self, obj):
        try:
            profile = obj.user.profile
            if profile.pokemon_icon_id:
                return profile.pokemon_icon.filename
        except Exception:
            pass
        return None

    def _get_pickup_display(self, obj):
        if obj.pickup_timeslot:
            return str(obj.pickup_timeslot)
        if obj.recurring_timeslot and obj.pickup_date:
            readable_date = obj.pickup_date.strftime('%A, %b %d').replace(' 0', ' ')
            rt = obj.recurring_timeslot
            time_range = f"{rt.start_time:%I:%M} - {rt.end_time:%I:%M}"
            label = f"{readable_date} \u2022 {time_range}"
            return f"{label} \u2022 {rt.location}" if rt.location else label
        if obj.recurring_timeslot:
            return str(obj.recurring_timeslot)
        if obj.delivery_method == 'asap':
            return 'ASAP / Downtown'
        return None

    def get_pickup_timeslot(self, obj):
        return self._get_pickup_display(obj)

    def get_recurring_timeslot(self, obj):
        return str(obj.recurring_timeslot) if obj.recurring_timeslot else None

    def get_delivery_details(self, obj):
        if obj.delivery_method == 'scheduled':
            return self._get_pickup_display(obj) or 'Scheduled campus pickup'
        return 'ASAP / Downtown'


class TradeCardInputSerializer(serializers.Serializer):
    card_name = serializers.CharField(max_length=200)
    estimated_value = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0.01'))
    condition = serializers.ChoiceField(choices=TradeCardItem.CONDITION_CHOICES, default='lightly_played')
    rarity = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    is_wanted_card = serializers.BooleanField(required=False, default=False)
    # TCG oracle fields - populated by autocomplete
    tcg_product_id = serializers.IntegerField(required=False, allow_null=True, default=None, min_value=1)
    tcg_sub_type = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    base_market_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, default=None, min_value=Decimal('0.01'))
    custom_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, default=None, min_value=Decimal('0.01'))

    def validate_card_name(self, value):
        value = sanitize_plain_text(value, max_length=200)
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value

    def validate_tcg_sub_type(self, value):
        return sanitize_plain_text(value, max_length=80)


class CheckoutItemSerializer(serializers.Serializer):
    item_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)


class CheckoutSerializer(serializers.Serializer):
    BACKUP_PAYMENT_CHOICES = [choice for choice in Order.PAYMENT_CHOICES if choice[0] in {'venmo', 'zelle', 'paypal'}]

    items = CheckoutItemSerializer(many=True)
    payment_method = serializers.ChoiceField(choices=Order.PAYMENT_CHOICES)
    delivery_method = serializers.ChoiceField(choices=Order.DELIVERY_CHOICES)
    pickup_slot_id = serializers.IntegerField(required=False, allow_null=True)
    pickup_timeslot_id = serializers.IntegerField(required=False, allow_null=True)
    recurring_timeslot_id = serializers.IntegerField(required=False, allow_null=True)
    pickup_date = serializers.DateField(required=False, allow_null=True)
    discord_handle = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    buy_if_trade_denied = serializers.BooleanField(required=False, default=False)
    preferred_pickup_time = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    backup_payment_method = serializers.ChoiceField(choices=BACKUP_PAYMENT_CHOICES, required=False, allow_blank=True, default='')
    coupon_code = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')
    trade_credit_total = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, default=None, min_value=Decimal('0'))

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError('At least one item is required.')
        return value

    def validate_discord_handle(self, value):
        return sanitize_plain_text(value, max_length=100)

    def validate_preferred_pickup_time(self, value):
        return sanitize_plain_text(value, max_length=255)

    def validate_trade_card_name(self, value):
        return sanitize_plain_text(value, max_length=100)

    def validate_coupon_code(self, value):
        return sanitize_plain_text(value, max_length=50).upper()

    def validate(self, attrs):
        payment_method = attrs.get('payment_method', '')
        items = attrs.get('items', [])
        subtotal = _compute_checkout_items_total(items)
        submitted_trade_credit = attrs.get('trade_credit_total') or Decimal('0.00')

        if payment_method == 'cash_plus_trade':
            backup_payment_method = attrs.get('backup_payment_method', '')
            cash_due = max(Decimal('0.00'), subtotal - submitted_trade_credit)
            if backup_payment_method:
                _validate_payment_minimum(backup_payment_method, cash_due)
        else:
            _validate_payment_minimum(payment_method, subtotal)

        return attrs


class CouponSerializer(serializers.ModelSerializer):
    specific_products = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Item.objects.all(), required=False,
    )
    specific_product_details = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Coupon
        fields = '__all__'
        read_only_fields = ('times_used', 'created_at')

    def get_specific_product_details(self, obj):
        return [{'id': p.id, 'title': p.title} for p in obj.specific_products.all()]

    def validate_code(self, value):
        value = sanitize_plain_text(value, max_length=50).upper()
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value


class SupportTicketSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source='user.email', read_only=True)
    order_uuid = serializers.UUIDField(source='order.order_id', read_only=True)

    class Meta:
        model = SupportTicket
        fields = [
            'id', 'ticket_id', 'user', 'user_email', 'order', 'order_uuid',
            'discord_user_id', 'discord_channel_id', 'subject', 'initial_message',
            'status', 'metadata', 'created_at', 'updated_at', 'closed_at',
        ]
        read_only_fields = ['id', 'ticket_id', 'user', 'user_email', 'order', 'order_uuid', 'created_at', 'updated_at', 'closed_at']


class SupportTicketCreateSerializer(serializers.Serializer):
    discord_user_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    discord_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    discord_channel_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    subject = serializers.CharField(max_length=200, required=False, allow_blank=True)
    category = serializers.CharField(max_length=200, required=False, allow_blank=True)
    initial_message = serializers.CharField(required=False, allow_blank=True, default='')
    message = serializers.CharField(required=False, allow_blank=True, default='')
    order_id = serializers.UUIDField(required=False, allow_null=True)
    metadata = serializers.JSONField(required=False, default=dict)

    def validate_discord_user_id(self, value):
        return validate_discord_snowflake(value, label='Discord user ID')

    def validate_discord_id(self, value):
        return validate_discord_snowflake(value, label='Discord user ID')

    def validate_discord_channel_id(self, value):
        return validate_compact_identifier(value, label='Discord channel/context ID')

    def validate_subject(self, value):
        return sanitize_plain_text(value, max_length=200)

    def validate_category(self, value):
        return sanitize_plain_text(value, max_length=200)

    def validate_initial_message(self, value):
        return sanitize_plain_text(value, multiline=True, max_length=2000)

    def validate_message(self, value):
        return sanitize_plain_text(value, multiline=True, max_length=2000)

    def validate_metadata(self, value):
        return sanitize_json_payload(value, max_depth=4, max_items=25, max_string_length=500)

    def validate(self, attrs):
        discord_user_id = (attrs.get('discord_user_id') or attrs.get('discord_id') or '').strip()
        subject = (attrs.get('subject') or attrs.get('category') or '').strip()
        initial_message = attrs.get('initial_message', '')
        if not initial_message and attrs.get('message'):
            initial_message = attrs['message']

        errors = {}
        if not discord_user_id:
            errors['discord_id'] = 'This field is required.'
        if not subject:
            errors['category'] = 'This field is required.'
        if errors:
            raise serializers.ValidationError(errors)

        attrs['discord_user_id'] = discord_user_id
        attrs['subject'] = subject
        attrs['initial_message'] = initial_message
        attrs['discord_channel_id'] = validate_compact_identifier(
            (attrs.get('discord_channel_id') or uuid.uuid4().hex[:32]).strip(),
            label='Discord channel/context ID',
        )
        return attrs


class CartItemSerializer(serializers.ModelSerializer):
    title = serializers.CharField(source='item.title', read_only=True)
    price = serializers.DecimalField(source='item.price', max_digits=10, decimal_places=2, read_only=True)
    image_path = serializers.CharField(source='item.image_path', read_only=True)
    description = serializers.CharField(source='item.short_description', read_only=True)
    max_per_user = serializers.IntegerField(source='item.max_per_user', read_only=True)
    stock = serializers.IntegerField(source='item.stock', read_only=True)
    item_id = serializers.IntegerField(source='item.id')

    class Meta:
        model = CartItem
        fields = ['id', 'item_id', 'title', 'price', 'image_path', 'description',
                  'max_per_user', 'stock', 'quantity', 'added_at']
        read_only_fields = ['id', 'added_at']


# ── Admin POS Serializers ───────────────────────────────────────────────────

class AdminCheckoutItemSerializer(serializers.Serializer):
    item_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, max_value=9999)


class AdminCheckoutSerializer(serializers.Serializer):
    # Restrict to in-person / manual payment methods only.
    # Trade-based methods are excluded: admins cannot create trade orders via POS.
    _ADMIN_POS_PAYMENT_CHOICES = [
        c for c in Order.PAYMENT_CHOICES if c[0] in {'venmo', 'zelle', 'paypal', 'cash'}
    ]

    target_user_id = serializers.IntegerField(min_value=1)
    items = AdminCheckoutItemSerializer(many=True)
    payment_method = serializers.ChoiceField(choices=_ADMIN_POS_PAYMENT_CHOICES)
    delivery_method = serializers.ChoiceField(choices=Order.DELIVERY_CHOICES)
    pickup_timeslot_id = serializers.IntegerField(required=False, allow_null=True, default=None, min_value=1)
    recurring_timeslot_id = serializers.IntegerField(required=False, allow_null=True, default=None, min_value=1)
    pickup_date = serializers.DateField(required=False, allow_null=True, default=None)
    discord_handle = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    admin_notes = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError('At least one item is required.')
        ids = [i['item_id'] for i in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError('Duplicate item IDs are not allowed.')
        return value

    def validate_discord_handle(self, value):
        return sanitize_plain_text(value, max_length=100)

    def validate_admin_notes(self, value):
        return sanitize_plain_text(value, max_length=500)

    def validate(self, attrs):
        subtotal = _compute_checkout_items_total(attrs.get('items', []))
        _validate_payment_minimum(attrs.get('payment_method', ''), subtotal)
        return attrs