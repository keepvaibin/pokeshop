import os
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from rest_framework import serializers
from .models import Item, PickupSlot

class ItemSerializer(serializers.ModelSerializer):
    image = serializers.FileField(write_only=True, required=False)

    class Meta:
        model = Item
        fields = ['id', 'title', 'description', 'image_path', 'stock', 'max_per_user', 'is_active', 'image']

    def create(self, validated_data):
        image = validated_data.pop('image', None)
        item = Item(**validated_data)

        if image:
            filename = default_storage.save(f'inventory_images/{os.path.basename(image.name)}', ContentFile(image.read()))
            image_url = f'{settings.MEDIA_URL}{filename}'
            if self.context.get('request'):
                image_url = self.context['request'].build_absolute_uri(image_url)
            item.image_path = image_url

        item.save()
        return item

class PickupSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickupSlot
        fields = '__all__'