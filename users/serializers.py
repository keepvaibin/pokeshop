import re
import html
from rest_framework import serializers
from .models import UserProfile


def strip_html_chars(value: str) -> str:
    """Strip HTML tags and escape dangerous characters from plain-text user input."""
    # Remove any HTML tags
    value = re.sub(r'<[^>]+>', '', value)
    # Unescape entites, then strip remaining angle brackets
    value = html.unescape(value)
    value = re.sub(r'[<>]', '', value)
    return value.strip()


class UserProfileSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = UserProfile
        fields = ['id', 'email', 'first_name', 'last_name', 'nickname', 'discord_handle', 'no_discord']
        read_only_fields = ['id', 'email']

    def validate_first_name(self, value):
        return strip_html_chars(value)

    def validate_last_name(self, value):
        return strip_html_chars(value)

    def validate_nickname(self, value):
        return strip_html_chars(value)

    def validate_discord_handle(self, value):
        value = strip_html_chars(value)
        if value and not re.match(r'^[a-zA-Z0-9_.#-]{2,32}$', value):
            raise serializers.ValidationError(
                'Discord handle must be 2–32 characters and contain only letters, digits, underscores, dots, hyphens, or #.'
            )
        return value
