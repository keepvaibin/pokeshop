from rest_framework import serializers
from .models import Item, ItemImage, WantedCard, WantedCardImage, PickupSlot, PokeshopSettings, PickupTimeslot, RecurringTimeslot, TCGCardPrice, AccessCode


class ItemImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ItemImage
        fields = ['id', 'url', 'position']

    def get_url(self, obj):
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url


class ItemSerializer(serializers.ModelSerializer):
    images = ItemImageSerializer(many=True, read_only=True)
    go_live_date = serializers.DateTimeField(required=False, allow_null=True, default=None)

    class Meta:
        model = Item
        fields = ['id', 'title', 'slug', 'description', 'short_description', 'price', 'image_path',
                  'stock', 'max_per_user', 'is_active', 'images', 'go_live_date']
        read_only_fields = ['slug']

    def to_internal_value(self, data):
        # Treat empty go_live_date string as None (common with multipart form data)
        # IMPORTANT: Never call QueryDict.copy() — deepcopy chokes on file streams.
        if hasattr(data, 'getlist'):
            data = {k: v for k, v in data.items()}
            if data.get('go_live_date') == '':
                data['go_live_date'] = None
        elif isinstance(data, dict) and data.get('go_live_date') == '':
            data = {**data, 'go_live_date': None}
        return super().to_internal_value(data)

    def create(self, validated_data):
        item = Item.objects.create(**validated_data)
        request = self.context.get('request')
        if request:
            for f in request.FILES.getlist('images'):
                ItemImage.objects.create(item=item, image=f)
        return item

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        request = self.context.get('request')
        if request and request.FILES.getlist('images'):
            instance.images.all().delete()
            for f in request.FILES.getlist('images'):
                ItemImage.objects.create(item=instance, image=f)
        return instance


class WantedCardImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = WantedCardImage
        fields = ['id', 'url', 'position']

    def get_url(self, obj):
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url


class WantedCardSerializer(serializers.ModelSerializer):
    images = WantedCardImageSerializer(many=True, read_only=True)
    tcg_product_id = serializers.IntegerField(write_only=True, required=False, allow_null=True, default=None)
    tcg_sub_type = serializers.CharField(write_only=True, required=False, allow_blank=True, default='')
    tcg_card_data = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = WantedCard
        fields = ['id', 'name', 'slug', 'description', 'estimated_value', 'is_active', 'images',
                  'tcg_product_id', 'tcg_sub_type', 'tcg_card_data']
        read_only_fields = ['slug']

    def get_tcg_card_data(self, obj):
        if obj.tcg_card_id:
            return TCGCardPriceSerializer(obj.tcg_card).data
        return None

    def _resolve_tcg_card(self, validated_data):
        """Pop write-only TCG fields and resolve to a TCGCardPrice FK."""
        product_id = validated_data.pop('tcg_product_id', None)
        sub_type = validated_data.pop('tcg_sub_type', '') or 'Normal'
        if product_id:
            tcg_card = TCGCardPrice.objects.filter(product_id=product_id, sub_type_name=sub_type).first()
            if tcg_card:
                validated_data['tcg_card'] = tcg_card
                # Auto-populate name/value if not overridden
                if not validated_data.get('name'):
                    validated_data['name'] = tcg_card.name
                if not validated_data.get('estimated_value') or validated_data['estimated_value'] == 0:
                    validated_data['estimated_value'] = tcg_card.market_price or 0

    def create(self, validated_data):
        self._resolve_tcg_card(validated_data)
        card = WantedCard.objects.create(**validated_data)
        request = self.context.get('request')
        if request:
            for f in request.FILES.getlist('images'):
                WantedCardImage.objects.create(card=card, image=f)
        return card

    def update(self, instance, validated_data):
        self._resolve_tcg_card(validated_data)
        instance = super().update(instance, validated_data)
        request = self.context.get('request')
        if request and request.FILES.getlist('images'):
            instance.images.all().delete()
            for f in request.FILES.getlist('images'):
                WantedCardImage.objects.create(card=instance, image=f)
        return instance


class PickupSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickupSlot
        fields = '__all__'


class PokeshopSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = PokeshopSettings
        fields = ['trade_credit_percentage', 'store_announcement', 'max_trade_cards_per_order', 'discord_webhook_url']


class PickupTimeslotSerializer(serializers.ModelSerializer):
    is_available = serializers.BooleanField(read_only=True)

    class Meta:
        model = PickupTimeslot
        fields = ['id', 'start', 'end', 'is_active', 'max_bookings', 'current_bookings', 'is_available']


class AccessCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccessCode
        fields = '__all__'
        read_only_fields = ('times_used', 'created_at')
        read_only_fields = ['current_bookings']


class RecurringTimeslotSerializer(serializers.ModelSerializer):
    bookings_this_week = serializers.SerializerMethodField()

    class Meta:
        model = RecurringTimeslot
        fields = ['id', 'day_of_week', 'start_time', 'end_time', 'max_bookings', 'is_active', 'bookings_this_week']

    def get_bookings_this_week(self, obj):
        """Count orders booked for this slot in the current week."""
        from django.utils import timezone
        from datetime import timedelta
        from orders.models import Order
        today = timezone.localdate()
        # Monday of this week
        monday = today - timedelta(days=today.weekday())
        # The specific date this slot maps to this week
        slot_date = monday + timedelta(days=obj.day_of_week)
        return Order.objects.filter(
            recurring_timeslot=obj,
            pickup_date=slot_date,
            status__in=['pending', 'fulfilled', 'trade_review', 'cash_needed'],
        ).count()


class TCGCardPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = TCGCardPrice
        fields = ['product_id', 'name', 'clean_name', 'group_name', 'sub_type_name', 'rarity', 'market_price', 'image_url']