from rest_framework import serializers
from .models import UserProfile


class UserProfileSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = UserProfile
        fields = ['id', 'email', 'first_name', 'last_name', 'nickname', 'discord_handle', 'no_discord']
        read_only_fields = ['id', 'email']
