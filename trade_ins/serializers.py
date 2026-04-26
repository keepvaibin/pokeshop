from decimal import Decimal

from rest_framework import serializers

from pokeshop.input_safety import sanitize_plain_text
from .models import TradeInRequest, TradeInItem, CreditLedger


class TradeInItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = TradeInItem
        fields = [
            'id', 'card_name', 'set_name', 'card_number',
            'condition', 'quantity', 'user_estimated_price',
        ]
        read_only_fields = ['id']

    def validate_card_name(self, value):
        cleaned = sanitize_plain_text(value, max_length=200)
        if not cleaned.strip():
            raise serializers.ValidationError('Card name is required.')
        return cleaned

    def validate_set_name(self, value):
        return sanitize_plain_text(value or '', max_length=200)

    def validate_card_number(self, value):
        return sanitize_plain_text(value or '', max_length=32)

    def validate_quantity(self, value):
        if value < 1:
            raise serializers.ValidationError('Quantity must be at least 1.')
        if value > 999:
            raise serializers.ValidationError('Quantity is unreasonably large.')
        return value

    def validate_user_estimated_price(self, value):
        if value < Decimal('0'):
            raise serializers.ValidationError('Estimated price cannot be negative.')
        return value


class TradeInRequestSerializer(serializers.ModelSerializer):
    items = TradeInItemSerializer(many=True)
    user_email = serializers.EmailField(source='user.email', read_only=True)
    discord_handle = serializers.SerializerMethodField()
    reviewed_by_email = serializers.EmailField(
        source='reviewed_by.email', read_only=True, default=None
    )

    class Meta:
        model = TradeInRequest
        fields = [
            'id', 'user_email', 'discord_handle',
            'status', 'submission_method',
            'estimated_total_value', 'final_payout_value',
            'customer_notes', 'admin_notes',
            'reviewed_by_email', 'reviewed_at', 'completed_at',
            'created_at', 'updated_at',
            'items',
        ]
        read_only_fields = [
            'id', 'user_email', 'discord_handle',
            'status', 'estimated_total_value', 'final_payout_value',
            'admin_notes', 'reviewed_by_email', 'reviewed_at',
            'completed_at', 'created_at', 'updated_at',
        ]

    def get_discord_handle(self, obj):
        profile = getattr(obj.user, 'profile', None)
        return getattr(profile, 'discord_handle', '') if profile else ''

    def validate_customer_notes(self, value):
        return sanitize_plain_text(value or '', max_length=2000)

    def validate(self, attrs):
        items = attrs.get('items') or []
        if not items:
            raise serializers.ValidationError({'items': 'Submit at least one card.'})
        if len(items) > 200:
            raise serializers.ValidationError({'items': 'Too many cards in a single request (max 200).'})
        return attrs

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        # Server-authoritative estimate: sum of (qty * user_estimated_price).
        total = sum(
            (Decimal(str(it['user_estimated_price'])) * it['quantity'])
            for it in items_data
        )
        validated_data['estimated_total_value'] = total.quantize(Decimal('0.01'))
        request_obj = TradeInRequest.objects.create(**validated_data)
        TradeInItem.objects.bulk_create([
            TradeInItem(request=request_obj, **item) for item in items_data
        ])
        return request_obj


class AdminTradeInReviewSerializer(serializers.Serializer):
    final_payout_value = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0')
    )
    admin_notes = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_admin_notes(self, value):
        return sanitize_plain_text(value or '', max_length=2000)


class AdminTradeInRejectSerializer(serializers.Serializer):
    admin_notes = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_admin_notes(self, value):
        return sanitize_plain_text(value or '', max_length=2000)


class CreditLedgerSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditLedger
        fields = [
            'id', 'amount', 'transaction_type', 'reference_id',
            'note', 'created_at',
        ]
        read_only_fields = fields
