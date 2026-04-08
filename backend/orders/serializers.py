from rest_framework import serializers
from .models import Order

class OrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = '__all__'
        read_only_fields = ('user', 'status', 'created_at')

class CheckoutSerializer(serializers.Serializer):
    item_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)
    payment_method = serializers.ChoiceField(choices=Order.PAYMENT_CHOICES)
    delivery_method = serializers.ChoiceField(choices=Order.DELIVERY_CHOICES)
    pickup_slot_id = serializers.IntegerField(required=False, allow_null=True)
    discord_handle = serializers.CharField(max_length=100)
    trade_card_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    trade_card_value = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    buy_if_trade_denied = serializers.BooleanField(default=False)