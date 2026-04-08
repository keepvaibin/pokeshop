from rest_framework import serializers
from .models import Item, PickupSlot, WantedCard, ItemImage, WantedCardImage

class ItemImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemImage
        fields = ['id', 'image_path']

class ItemSerializer(serializers.ModelSerializer):
    images = ItemImageSerializer(many=True, read_only=True)
    image = serializers.FileField(write_only=True, required=False)
    price = serializers.DecimalField(max_digits=8, decimal_places=2, write_only=True, required=False)

    class Meta:
        model = Item
        fields = ['id', 'title', 'slug', 'description', 'price', 'stock', 'max_per_user', 'is_active', 'images', 'image']

    def create(self, validated_data):
        validated_data.pop('price', None)
        image = validated_data.pop('image', None)
        item = Item(**validated_data)

        item.save()

        if image:
            filename = default_storage.save(f'inventory_images/{os.path.basename(image.name)}', ContentFile(image.read()))
            image_url = f'{settings.MEDIA_URL}{filename}'
            if self.context.get('request'):
                image_url = self.context['request'].build_absolute_uri(image_url)
            ItemImage.objects.create(item=item, image_path=image_url)

        return item

class WantedCardImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = WantedCardImage
        fields = ['id', 'image_path']

class WantedCardSerializer(serializers.ModelSerializer):
    images = WantedCardImageSerializer(many=True, read_only=True)
    image = serializers.FileField(write_only=True, required=False)
    price = serializers.DecimalField(max_digits=8, decimal_places=2, write_only=True, required=False)

    class Meta:
        model = WantedCard
        fields = ['id', 'title', 'description', 'price', 'is_active', 'images', 'image']

    def create(self, validated_data):
        validated_data.pop('price', None)
        image = validated_data.pop('image', None)
        wanted_card = WantedCard(**validated_data)

        wanted_card.save()

        if image:
            filename = default_storage.save(f'wanted_images/{os.path.basename(image.name)}', ContentFile(image.read()))
            image_url = f'{settings.MEDIA_URL}{filename}'
            if self.context.get('request'):
                image_url = self.context['request'].build_absolute_uri(image_url)
            WantedCardImage.objects.create(wanted_card=wanted_card, image_path=image_url)

        return wanted_card

class PickupSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickupSlot
        fields = '__all__'