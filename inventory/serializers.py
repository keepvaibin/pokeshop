import json

from django.utils import timezone
from rest_framework import serializers
from pokeshop.input_safety import (
    sanitize_plain_text,
    validate_asset_url,
    validate_http_url,
    validate_navigation_url,
)
from .models import (
    Item, ItemImage, WantedCard, WantedCardImage, PickupSlot,
    PokeshopSettings, PickupTimeslot, RecurringTimeslot, TCGCardPrice,
    AccessCode, InventoryDrop, Category, SubCategory, ItemTag, PromoBanner, HomepageSection,
)


# ---------------------------------------------------------------------------
# Category / SubCategory
# ---------------------------------------------------------------------------

class SubCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SubCategory
        fields = ['id', 'category', 'name', 'slug', 'is_active']

    def validate_name(self, value):
        value = sanitize_plain_text(value, max_length=100)
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value


class ItemTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemTag
        fields = ['id', 'name', 'slug', 'is_active']

    def validate_name(self, value):
        value = sanitize_plain_text(value, max_length=100)
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value


class CategorySerializer(serializers.ModelSerializer):
    subcategories = SubCategorySerializer(many=True, read_only=True)
    tags = ItemTagSerializer(many=True, read_only=True)

    class Meta:
        model = Category
        fields = ['id', 'name', 'slug', 'image_url', 'is_active', 'is_core', 'subcategories', 'tags']

    def validate_name(self, value):
        value = sanitize_plain_text(value, max_length=100)
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value

    def validate_image_url(self, value):
        if value in (None, ''):
            return value
        return validate_http_url(value, label='Category image URL')


# ---------------------------------------------------------------------------
# Promo Banner
# ---------------------------------------------------------------------------

class PromoBannerSerializer(serializers.ModelSerializer):
    image_url = serializers.CharField(required=False, allow_blank=True, default='')
    image = serializers.ImageField(required=False, allow_null=True)
    display_image_url = serializers.SerializerMethodField()

    class Meta:
        model = PromoBanner
        fields = ['id', 'title', 'subtitle', 'image_url', 'image', 'display_image_url', 'link_url', 'size', 'position_order', 'is_active']

    def get_display_image_url(self, obj):
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return obj.image_url or ''

    def validate_title(self, value):
        value = sanitize_plain_text(value, max_length=200)
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value

    def validate_subtitle(self, value):
        if value in (None, ''):
            return value
        return sanitize_plain_text(value, max_length=300)

    def validate_image_url(self, value):
        if not value:
            return value
        return validate_http_url(value, label='Banner image URL')

    def validate_link_url(self, value):
        return validate_navigation_url(value)

    def validate(self, data):
        has_url = bool(data.get('image_url'))
        has_file = bool(data.get('image'))
        if not has_url and not has_file:
            if self.instance:
                if not self.instance.image and not self.instance.image_url:
                    raise serializers.ValidationError('Either image_url or image file is required.')
            else:
                raise serializers.ValidationError('Either image_url or image file is required.')
        return data


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


class InventoryDropSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryDrop
        fields = ['id', 'item', 'quantity', 'drop_time', 'is_processed', 'created_at']
        read_only_fields = ['is_processed', 'created_at']


class ItemSerializer(serializers.ModelSerializer):
    images = ItemImageSerializer(many=True, read_only=True)
    scheduled_drops = InventoryDropSerializer(many=True, read_only=True)
    published_at = serializers.DateTimeField(required=False, allow_null=True, default=None)
    max_per_user = serializers.IntegerField(required=False, min_value=0, default=0)
    category_slug = serializers.SlugRelatedField(source='category', slug_field='slug', read_only=True)
    tags = ItemTagSerializer(many=True, read_only=True)

    class Meta:
        model = Item
        fields = ['id', 'title', 'slug', 'description', 'short_description', 'price', 'image_path',
                  'stock', 'max_per_user', 'is_active', 'images', 'published_at', 'preview_before_release',
                  'scheduled_drops',
                  'tcg_set_name', 'rarity', 'is_holofoil', 'card_number', 'api_id',
                  'category', 'category_slug', 'subcategory', 'tags',
                  'tcg_type', 'tcg_stage', 'rarity_type',
                  'tcg_supertype', 'tcg_subtypes', 'tcg_hp', 'tcg_artist', 'tcg_set_release_date',
                  'created_at']
        read_only_fields = ['slug', 'created_at', 'category_slug']

    def _parse_tag_names(self, raw_value):
        if raw_value in (None, '', []):
            return []
        if isinstance(raw_value, list):
            values = raw_value
        elif isinstance(raw_value, str):
            try:
                parsed = json.loads(raw_value)
            except json.JSONDecodeError:
                parsed = [part.strip() for part in raw_value.split(',') if part.strip()]
            values = parsed if isinstance(parsed, list) else [str(parsed)]
        else:
            values = [str(raw_value)]

        deduped = []
        seen = set()
        for value in values:
            normalized = sanitize_plain_text(str(value), max_length=100)
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(normalized)
        return deduped

    def _sync_tags(self, item, category):
        if not getattr(self, '_incoming_tag_names_provided', False):
            return
        if category is None or category.is_core:
            item.tags.clear()
            return

        tags = []
        for tag_name in self._incoming_tag_names:
            existing = ItemTag.objects.filter(category=category, name__iexact=tag_name).first()
            if existing:
                if not existing.is_active:
                    existing.is_active = True
                    existing.save(update_fields=['is_active'])
                tags.append(existing)
                continue
            tags.append(ItemTag.objects.create(category=category, name=tag_name))
        item.tags.set(tags)

    def validate_title(self, value):
        value = sanitize_plain_text(value, max_length=255)
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value

    def validate_description(self, value):
        if not value:
            return value
        # Replace non-breaking spaces (common Word/PDF paste artifact) with regular spaces.
        return value.replace('\u00A0', ' ').replace('&nbsp;', ' ')

    def validate_short_description(self, value):
        return sanitize_plain_text(value, max_length=300)

    def validate_image_path(self, value):
        return validate_asset_url(value)

    def validate_tcg_set_name(self, value):
        if value in (None, ''):
            return value
        return sanitize_plain_text(value, max_length=100)

    def validate_rarity(self, value):
        if value in (None, ''):
            return value
        return sanitize_plain_text(value, max_length=50)

    def validate_card_number(self, value):
        if value in (None, ''):
            return value
        return sanitize_plain_text(value, max_length=20)

    def validate_api_id(self, value):
        if value in (None, ''):
            return value
        return sanitize_plain_text(value, max_length=50)

    def validate_tcg_supertype(self, value):
        if value in (None, ''):
            return value
        return sanitize_plain_text(value, max_length=20)

    def validate_tcg_subtypes(self, value):
        if value in (None, ''):
            return value
        return sanitize_plain_text(value, max_length=200)

    def validate_tcg_artist(self, value):
        if value in (None, ''):
            return value
        return sanitize_plain_text(value, max_length=100)

    def to_internal_value(self, data):
        # Treat empty published_at string as None (common with multipart form data)
        # IMPORTANT: Never call QueryDict.copy() - deepcopy chokes on file streams.
        if hasattr(data, 'getlist'):
            self._incoming_tag_names_provided = 'tag_names' in data
            self._incoming_tag_names = self._parse_tag_names(data.get('tag_names'))
            data = {k: v for k, v in data.items() if k != 'tag_names'}
            if data.get('published_at') == '':
                data['published_at'] = None
            if data.get('max_per_user') == '':
                data['max_per_user'] = 0
        elif isinstance(data, dict):
            self._incoming_tag_names_provided = 'tag_names' in data
            self._incoming_tag_names = self._parse_tag_names(data.get('tag_names'))
            data = {k: v for k, v in data.items() if k != 'tag_names'}
            if data.get('published_at') == '':
                data = {**data, 'published_at': None}
            if data.get('max_per_user') == '':
                data = {**data, 'max_per_user': 0}
        return super().to_internal_value(data)

    def _apply_default_published_at(self, validated_data):
        published_at_was_provided = 'published_at' in getattr(self, 'initial_data', {})
        if self.partial and not published_at_was_provided:
            return validated_data
        if validated_data.get('published_at') is None:
            validated_data['published_at'] = timezone.now()
        return validated_data

    def create(self, validated_data):
        validated_data = self._apply_default_published_at(validated_data)
        item = Item.objects.create(**validated_data)
        request = self.context.get('request')
        if request:
            for f in request.FILES.getlist('images'):
                ItemImage.objects.create(item=item, image=f)
        self._sync_tags(item, item.category)
        return item

    def update(self, instance, validated_data):
        validated_data = self._apply_default_published_at(validated_data)
        instance = super().update(instance, validated_data)
        request = self.context.get('request')
        if request and request.FILES.getlist('images'):
            instance.images.all().delete()
            for f in request.FILES.getlist('images'):
                ItemImage.objects.create(item=instance, image=f)
        self._sync_tags(instance, instance.category)
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

    def validate_name(self, value):
        value = sanitize_plain_text(value, max_length=255)
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value

    def validate_tcg_sub_type(self, value):
        return sanitize_plain_text(value, max_length=80)

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
        fields = [
            'trade_credit_percentage',
            'store_announcement',
            'announcement_expires_at',
            'show_footer_newsletter',
            'max_trade_cards_per_order',
            'discord_webhook_url',
            'ucsc_discord_invite',
            'public_discord_invite',
            'is_ooo',
            'ooo_until',
            'orders_disabled',
            'pay_venmo_enabled',
            'pay_zelle_enabled',
            'pay_paypal_enabled',
            'pay_cash_enabled',
            'pay_trade_enabled',
        ]

    def validate_store_announcement(self, value):
        return sanitize_plain_text(value, multiline=True)

    def validate_discord_webhook_url(self, value):
        if value in (None, ''):
            return ''
        return validate_http_url(value, label='Discord webhook URL')

    def validate_ucsc_discord_invite(self, value):
        if value in (None, ''):
            return value
        return validate_http_url(value, label='UCSC Discord invite URL')

    def validate_public_discord_invite(self, value):
        if value in (None, ''):
            return value
        return validate_http_url(value, label='Public Discord invite URL')


class PickupTimeslotSerializer(serializers.ModelSerializer):
    current_bookings = serializers.SerializerMethodField()
    is_available = serializers.BooleanField(read_only=True)

    class Meta:
        model = PickupTimeslot
        fields = ['id', 'start', 'end', 'is_active', 'max_bookings', 'current_bookings', 'is_available']
        read_only_fields = ['current_bookings', 'is_available']

    def get_current_bookings(self, obj):
        return obj.booking_count_value()


class AccessCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccessCode
        fields = '__all__'
        read_only_fields = ('times_used', 'created_at')


class RecurringTimeslotSerializer(serializers.ModelSerializer):
    pickup_date = serializers.SerializerMethodField()
    bookings_this_week = serializers.SerializerMethodField()

    class Meta:
        model = RecurringTimeslot
        fields = ['id', 'day_of_week', 'start_time', 'end_time', 'location', 'max_bookings', 'is_active', 'pickup_date', 'bookings_this_week']

    def get_pickup_date(self, obj):
        return obj.next_pickup_date().isoformat()

    def get_bookings_this_week(self, obj):
        pickup_date = obj.next_pickup_date()
        counts = self.context.get('recurring_booking_counts')
        if counts is not None:
            return counts.get((obj.id, pickup_date), 0)
        return obj.active_booking_count(pickup_date=pickup_date)


class TCGCardPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = TCGCardPrice
        fields = ['product_id', 'name', 'clean_name', 'group_name', 'sub_type_name', 'rarity', 'market_price', 'image_url']


# ---------------------------------------------------------------------------
# Homepage Section
# ---------------------------------------------------------------------------

class HomepageSectionSerializer(serializers.ModelSerializer):
    items = ItemSerializer(many=True, read_only=True)
    banners = PromoBannerSerializer(many=True, read_only=True)
    item_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Item.objects.all(), write_only=True, required=False, source='items'
    )
    banner_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=PromoBanner.objects.all(), write_only=True, required=False, source='banners'
    )

    class Meta:
        model = HomepageSection
        fields = ['id', 'title', 'section_type', 'position_order', 'is_active',
                  'items', 'banners', 'item_ids', 'banner_ids']

    def validate_title(self, value):
        value = sanitize_plain_text(value, max_length=150)
        if not value:
            raise serializers.ValidationError('This field may not be blank.')
        return value

    def create(self, validated_data):
        items = validated_data.pop('items', [])
        banners = validated_data.pop('banners', [])
        section = HomepageSection.objects.create(**validated_data)
        section.items.set(items)
        section.banners.set(banners)
        return section

    def update(self, instance, validated_data):
        items = validated_data.pop('items', None)
        banners = validated_data.pop('banners', None)
        instance = super().update(instance, validated_data)
        if items is not None:
            instance.items.set(items)
        if banners is not None:
            instance.banners.set(banners)
        return instance