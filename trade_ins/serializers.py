from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from pokeshop.input_safety import sanitize_plain_text, validate_http_url
from inventory.models import PokeshopSettings, RecurringTimeslot, TCGCardPrice
from inventory.trade_utils import calc_trade_credit
from orders.scheduling import validate_customer_pickup_date
from .models import TradeInRequest, TradeInItem, CreditLedger


CHECKOUT_TO_TRADE_IN_CONDITION = {
    'near_mint': 'NM',
    'lightly_played': 'LP',
    'moderately_played': 'MP',
    'heavily_played': 'HP',
    'damaged': 'DMG',
}


def _django_validation_message(exc):
    messages = getattr(exc, 'messages', None)
    if messages:
        return ' '.join(str(message) for message in messages)
    return str(getattr(exc, 'message', exc))

TRADE_IN_TO_CHECKOUT_CONDITION = {
    'NM': 'near_mint',
    'LP': 'lightly_played',
    'MP': 'moderately_played',
    'HP': 'heavily_played',
    'DMG': 'damaged',
}


class TradeInItemSerializer(serializers.ModelSerializer):
    computed_credit = serializers.SerializerMethodField()
    user_estimated_price = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        min_value=Decimal('0'),
    )
    estimated_value = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
        write_only=True,
        min_value=Decimal('0.01'),
    )

    class Meta:
        model = TradeInItem
        fields = [
            'id', 'card_name', 'set_name', 'card_number',
            'condition', 'quantity', 'user_estimated_price', 'estimated_value',
            'image_url', 'tcg_product_id', 'tcg_sub_type', 'base_market_price',
            'tcgplayer_url', 'is_accepted', 'admin_override_value', 'computed_credit',
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

    def validate(self, attrs):
        has_oracle_pricing = attrs.get('tcg_product_id') or attrs.get('base_market_price') is not None
        has_manual_estimate = attrs.get('estimated_value') is not None or attrs.get('user_estimated_price') is not None
        if not has_oracle_pricing and not has_manual_estimate:
            raise serializers.ValidationError({'estimated_value': 'Provide a card value before submitting.'})
        return attrs

    def validate_image_url(self, value):
        if value in (None, ''):
            return ''
        return validate_http_url(value, label='Card image URL')

    def validate_tcg_sub_type(self, value):
        return sanitize_plain_text(value or '', max_length=80)

    def validate_tcgplayer_url(self, value):
        if value in (None, ''):
            return ''
        return validate_http_url(value, label='TCGPlayer URL')


class TradeInRequestSerializer(serializers.ModelSerializer):
    items = TradeInItemSerializer(many=True)
    user_email = serializers.EmailField(source='user.email', read_only=True)
    discord_handle = serializers.SerializerMethodField()
    reviewed_by_email = serializers.EmailField(
        source='reviewed_by.email', read_only=True, default=None
    )
    recurring_timeslot = serializers.PrimaryKeyRelatedField(
        queryset=RecurringTimeslot.objects.filter(is_active=True),
        required=True,
    )
    pickup_label = serializers.SerializerMethodField()
    payout_label = serializers.SerializerMethodField()

    class Meta:
        model = TradeInRequest
        fields = [
            'id', 'user_email', 'discord_handle',
            'status', 'submission_method', 'payout_type', 'cash_payment_method', 'payout_label',
            'recurring_timeslot', 'pickup_date', 'pickup_label',
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
            'pickup_label', 'payout_label', 'admin_notes', 'reviewed_by_email', 'reviewed_at',
            'completed_at', 'created_at', 'updated_at',
        ]

    def get_discord_handle(self, obj):
        profile = getattr(obj.user, 'profile', None)
        return getattr(profile, 'discord_handle', '') if profile else ''

    def get_pickup_label(self, obj):
        if not obj.recurring_timeslot or not obj.pickup_date:
            return ''
        readable_date = obj.pickup_date.strftime('%A, %b %d').replace(' 0', ' ')
        return f'{readable_date} • {obj.recurring_timeslot}'

    def get_payout_label(self, obj):
        if obj.payout_type == TradeInRequest.PAYOUT_TYPE_CASH and obj.cash_payment_method:
            return f'Cash via {obj.get_cash_payment_method_display()}'
        return obj.get_payout_type_display()

    def validate_customer_notes(self, value):
        return sanitize_plain_text(value or '', max_length=2000)

    def validate(self, attrs):
        items = attrs.get('items') or []
        if not items:
            raise serializers.ValidationError({'items': 'Submit at least one card.'})
        if len(items) > 200:
            raise serializers.ValidationError({'items': 'Too many cards in a single request (max 200).'})
        recurring_timeslot = attrs.get('recurring_timeslot')
        pickup_date = attrs.get('pickup_date')
        payout_type = attrs.get('payout_type') or TradeInRequest.PAYOUT_TYPE_STORE_CREDIT
        cash_payment_method = (attrs.get('cash_payment_method') or '').strip()
        if not recurring_timeslot or not pickup_date:
            raise serializers.ValidationError({'pickup_date': 'Choose a drop-off timeslot.'})
        if not recurring_timeslot.has_customer_usable_window:
            raise serializers.ValidationError({'recurring_timeslot': 'This drop-off time is no longer available. Please choose another pickup time.'})
        try:
            pickup_date = validate_customer_pickup_date(pickup_date)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'pickup_date': _django_validation_message(exc)})
        attrs['pickup_date'] = pickup_date
        if pickup_date.weekday() != recurring_timeslot.day_of_week:
            raise serializers.ValidationError({'pickup_date': 'Selected pickup date does not match the pickup timeslot day.'})
        if recurring_timeslot.active_booking_count(pickup_date=pickup_date) >= recurring_timeslot.max_bookings:
            raise serializers.ValidationError({'pickup_date': 'This drop-off timeslot is fully booked.'})
        settings_obj = PokeshopSettings.load()
        if payout_type == TradeInRequest.PAYOUT_TYPE_CASH:
            if not cash_payment_method:
                raise serializers.ValidationError({'cash_payment_method': 'Choose a cash payment method.'})
            enabled_methods = {
                'venmo': settings_obj.pay_venmo_enabled,
                'zelle': settings_obj.pay_zelle_enabled,
                'paypal': settings_obj.pay_paypal_enabled,
            }
            if not enabled_methods.get(cash_payment_method, False):
                raise serializers.ValidationError({'cash_payment_method': 'That cash payment method is currently unavailable.'})
        else:
            attrs['cash_payment_method'] = ''
        return attrs

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        settings_obj = PokeshopSettings.load()
        payout_type = validated_data.get('payout_type') or TradeInRequest.PAYOUT_TYPE_STORE_CREDIT
        credit_percentage = Decimal(str(
            settings_obj.trade_cash_percentage
            if payout_type == TradeInRequest.PAYOUT_TYPE_CASH
            else settings_obj.trade_credit_percentage
        ))
        recurring_timeslot = validated_data.get('recurring_timeslot')
        pickup_date = validated_data.get('pickup_date')
        if recurring_timeslot and pickup_date:
            locked_timeslot = RecurringTimeslot.objects.select_for_update().get(pk=recurring_timeslot.pk, is_active=True)
            if not locked_timeslot.has_customer_usable_window:
                raise serializers.ValidationError({'recurring_timeslot': 'This drop-off time is no longer available. Please choose another pickup time.'})
            if pickup_date.weekday() != locked_timeslot.day_of_week:
                raise serializers.ValidationError({'pickup_date': 'Selected pickup date does not match the pickup timeslot day.'})
            if locked_timeslot.active_booking_count(pickup_date=pickup_date) >= locked_timeslot.max_bookings:
                raise serializers.ValidationError({'pickup_date': 'This drop-off timeslot is fully booked.'})
            validated_data['recurring_timeslot'] = locked_timeslot

        oracle_lookup_keys = {
            (item.get('tcg_product_id'), item.get('tcg_sub_type') or 'Normal')
            for item in items_data
            if item.get('tcg_product_id')
        }
        oracle_cards_by_key = {}
        oracle_cards_by_product = {}
        if oracle_lookup_keys:
            product_ids = {product_id for product_id, _sub_type_name in oracle_lookup_keys}
            for card in TCGCardPrice.objects.filter(product_id__in=product_ids, market_price__isnull=False).order_by('-updated_at'):
                oracle_cards_by_key[(card.product_id, card.sub_type_name or 'Normal')] = card
                oracle_cards_by_product.setdefault(card.product_id, card)

        for item in items_data:
            tcg_product_id = item.get('tcg_product_id')
            tcg_sub_type = item.get('tcg_sub_type') or 'Normal'
            raw_estimated_value = item.pop('estimated_value', None)
            checkout_condition = TRADE_IN_TO_CHECKOUT_CONDITION.get(
                item.get('condition'),
                'lightly_played',
            )
            oracle_card = None
            if tcg_product_id:
                oracle_card = oracle_cards_by_key.get((tcg_product_id, tcg_sub_type)) or oracle_cards_by_product.get(tcg_product_id)
            if oracle_card:
                item['base_market_price'] = oracle_card.market_price
                item['image_url'] = item.get('image_url') or oracle_card.image_url
                item['tcg_sub_type'] = oracle_card.sub_type_name or tcg_sub_type
                item['tcgplayer_url'] = item.get('tcgplayer_url') or oracle_card.tcgplayer_url or f'https://www.tcgplayer.com/product/{oracle_card.product_id}'
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
            elif raw_estimated_value is not None:
                item['user_estimated_price'] = (
                    Decimal(str(raw_estimated_value)) * (credit_percentage / Decimal('100'))
                ).quantize(Decimal('0.01'))

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

    def validate(self, attrs):
        decisions = attrs.get('card_decisions') or {}
        send_counteroffer = attrs.get('send_counteroffer', False)
        has_overrides = any(
            entry.get('overridden_value') is not None
            for entry in decisions.values()
        )
        if has_overrides and not send_counteroffer:
            raise serializers.ValidationError({
                'send_counteroffer': 'Price overrides require a counteroffer before approval.',
            })
        return attrs


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
