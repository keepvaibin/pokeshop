from decimal import Decimal
from rest_framework import serializers
from .models import Order, TradeOffer, TradeCardItem, Coupon


class TradeCardItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = TradeCardItem
        fields = ['id', 'card_name', 'estimated_value', 'condition', 'rarity', 'photo', 'is_wanted_card', 'approved', 'is_accepted',
                  'tcg_product_id', 'tcg_sub_type', 'base_market_price', 'custom_price', 'admin_override_value']
        read_only_fields = ['approved', 'is_accepted']


class TradeOfferSerializer(serializers.ModelSerializer):
    cards = TradeCardItemSerializer(many=True, read_only=True)

    class Meta:
        model = TradeOffer
        fields = ['id', 'total_credit', 'credit_percentage', 'trade_mode', 'cards', 'created_at']


class OrderSerializer(serializers.ModelSerializer):
    item_title = serializers.CharField(source='item.title', read_only=True)
    item_price = serializers.DecimalField(source='item.price', max_digits=8, decimal_places=2, read_only=True)
    trade_offer = TradeOfferSerializer(read_only=True)
    user_email = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = Order
        fields = '__all__'
        read_only_fields = ('user', 'status', 'created_at')


class TradeCardInputSerializer(serializers.Serializer):
    card_name = serializers.CharField(max_length=200)
    estimated_value = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0.01'))
    condition = serializers.ChoiceField(choices=TradeCardItem.CONDITION_CHOICES, default='lightly_played')
    rarity = serializers.ChoiceField(choices=TradeCardItem.RARITY_CHOICES, required=False, default='')
    is_wanted_card = serializers.BooleanField(required=False, default=False)
    # TCG oracle fields — populated by autocomplete
    tcg_product_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    tcg_sub_type = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    base_market_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, default=None)
    custom_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, default=None)


class CheckoutSerializer(serializers.Serializer):
    item_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)
    payment_method = serializers.ChoiceField(choices=Order.PAYMENT_CHOICES)
    delivery_method = serializers.ChoiceField(choices=Order.DELIVERY_CHOICES)
    pickup_slot_id = serializers.IntegerField(required=False, allow_null=True)
    pickup_timeslot_id = serializers.IntegerField(required=False, allow_null=True)
    recurring_timeslot_id = serializers.IntegerField(required=False, allow_null=True)
    pickup_date = serializers.DateField(required=False, allow_null=True)
    discord_handle = serializers.CharField(max_length=100)
    buy_if_trade_denied = serializers.BooleanField(required=False, default=False)
    preferred_pickup_time = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    # Legacy single-card fields (kept for backward compat)
    trade_card_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    trade_card_value = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    # Backup payment for partial-trade orders
    backup_payment_method = serializers.CharField(max_length=20, required=False, allow_blank=True, default='')


class CouponSerializer(serializers.ModelSerializer):
    class Meta:
        model = Coupon
        fields = '__all__'
        read_only_fields = ('times_used', 'created_at')