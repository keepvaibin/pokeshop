from decimal import Decimal

from rest_framework import serializers

from pokeshop.input_safety import sanitize_plain_text, validate_http_url
from inventory.models import PokeshopSettings, TCGCardPrice
from inventory.trade_utils import calc_trade_credit
from .models import TradeInRequest, TradeInItem, CreditLedger


CHECKOUT_TO_TRADE_IN_CONDITION = {
    'near_mint': 'NM',
    'lightly_played': 'LP',
    'moderately_played': 'MP',
    'heavily_played': 'HP',
    'damaged': 'DMG',
}

TRADE_IN_TO_CHECKOUT_CONDITION = {
    'NM': 'near_mint',
    'LP': 'lightly_played',
    'MP': 'moderately_played',
    'HP': 'heavily_played',
    'DMG': 'damaged',
}


class TradeInItemSerializer(serializers.ModelSerializer):
    computed_credit = serializers.SerializerMethodField()

    class Meta:
        model = TradeInItem
        fields = [
            'id', 'card_name', 'set_name', 'card_number',
            'condition', 'quantity', 'user_estimated_price',
            'image_url', 'tcg_product_id', 'tcg_sub_type', 'base_market_price',
            'is_accepted', 'admin_override_value', 'computed_credit',
        ]
        read_only_fields = ['id', 'is_accepted', 'admin_override_value', 'computed_credit']

    def get_computed_credit(self, obj):
        return str((Decimal(str(obj.user_estimated_price or 0)) * obj.quantity).quantize(Decimal('0.01')))

    def to_internal_value(self, data):
        if isinstance(data, dict):
            data = data.copy()
            condition = data.get('condition')
            if condition in CHECKOUT_TO_TRADE_IN_CONDITION:
                data['condition'] = CHECKOUT_TO_TRADE_IN_CONDITION[condition]
        return super().to_internal_value(data)

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

    def validate_image_url(self, value):
        if value in (None, ''):
            return ''
        return validate_http_url(value, label='Card image URL')

    def validate_tcg_sub_type(self, value):
        return sanitize_plain_text(value or '', max_length=80)


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
            'estimated_total_value', 'credit_percentage', 'final_payout_value',
            'counteroffer_message', 'counteroffer_expires_at',
            'customer_notes', 'admin_notes',
            'reviewed_by_email', 'reviewed_at', 'completed_at',
            'created_at', 'updated_at',
            'items',
        ]
        read_only_fields = [
            'id', 'user_email', 'discord_handle',
            'status', 'estimated_total_value', 'credit_percentage', 'final_payout_value',
            'counteroffer_message', 'counteroffer_expires_at',
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
        settings_obj = PokeshopSettings.load()
        credit_percentage = Decimal(str(settings_obj.trade_credit_percentage))

        oracle_lookup_keys = {
            (item.get('tcg_product_id'), item.get('tcg_sub_type') or 'Normal')
            for item in items_data
            if item.get('tcg_product_id')
        }
        oracle_cards_by_key = {}
        if oracle_lookup_keys:
            for product_id, sub_type_name in oracle_lookup_keys:
                card = TCGCardPrice.objects.filter(
                    product_id=product_id,
                    sub_type_name=sub_type_name,
                    market_price__isnull=False,
                ).first()
                if card:
                    oracle_cards_by_key[(product_id, sub_type_name)] = card

        for item in items_data:
            tcg_product_id = item.get('tcg_product_id')
            tcg_sub_type = item.get('tcg_sub_type') or 'Normal'
            checkout_condition = TRADE_IN_TO_CHECKOUT_CONDITION.get(
                item.get('condition'),
                'lightly_played',
            )
            oracle_card = oracle_cards_by_key.get((tcg_product_id, tcg_sub_type)) if tcg_product_id else None
            if oracle_card:
                item['base_market_price'] = oracle_card.market_price
                item['image_url'] = item.get('image_url') or oracle_card.image_url
                item['tcg_sub_type'] = oracle_card.sub_type_name or tcg_sub_type
                item['user_estimated_price'] = calc_trade_credit(
                    oracle_card.market_price,
                    checkout_condition,
                    credit_percentage,
                )
            elif item.get('base_market_price') is not None:
                base_value = Decimal(str(item['base_market_price']))
                item['user_estimated_price'] = calc_trade_credit(
                    base_value,
                    checkout_condition,
                    credit_percentage,
                )

        # Server-authoritative estimate: sum of (qty * computed credit per card).
        total = sum(
            (Decimal(str(it['user_estimated_price'])) * it['quantity'])
            for it in items_data
        )
        validated_data['estimated_total_value'] = total.quantize(Decimal('0.01'))
        validated_data['credit_percentage'] = credit_percentage
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


class AdminTradeInCardReviewSerializer(serializers.Serializer):
    card_decisions = serializers.DictField()
    counteroffer_message = serializers.CharField(required=False, allow_blank=True, default='')
    send_counteroffer = serializers.BooleanField(required=False, default=False)

    def validate_counteroffer_message(self, value):
        return sanitize_plain_text(value or '', multiline=True, max_length=1000)

    def validate_card_decisions(self, value):
        if not value:
            raise serializers.ValidationError('At least one card decision is required.')
        normalized = {}
        for raw_key, raw_decision in value.items():
            try:
                item_id = str(int(raw_key))
            except (TypeError, ValueError):
                raise serializers.ValidationError('Card decision keys must be item IDs.')
            if isinstance(raw_decision, dict):
                decision = raw_decision.get('decision')
                override_val = raw_decision.get('overridden_value')
            else:
                decision = raw_decision
                override_val = None
            if decision not in ('accept', 'reject'):
                raise serializers.ValidationError('Each card decision must be accept or reject.')
            normalized_override = None
            if decision == 'accept' and override_val not in (None, ''):
                try:
                    normalized_override = Decimal(str(override_val)).quantize(Decimal('0.01'))
                except Exception:
                    raise serializers.ValidationError('Override values must be valid dollar amounts.')
                if normalized_override < Decimal('0.00'):
                    raise serializers.ValidationError('Override values cannot be negative.')
            normalized[item_id] = {'decision': decision, 'overridden_value': normalized_override}
        return normalized


class CustomerTradeInCounterOfferResponseSerializer(serializers.Serializer):
    response = serializers.ChoiceField(choices=['accept', 'decline'])


class CreditLedgerSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditLedger
        fields = [
            'id', 'amount', 'transaction_type', 'reference_id',
            'note', 'created_at',
        ]
        read_only_fields = fields
