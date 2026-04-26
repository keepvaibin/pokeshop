import re
from rest_framework import serializers
from .models import UserProfile, PokemonIcon
from pokeshop.input_safety import sanitize_plain_text


def strip_html_chars(value: str) -> str:
    """Strip HTML tags and escape dangerous characters from plain-text user input."""
    return sanitize_plain_text(value)


class PokemonIconSerializer(serializers.ModelSerializer):
    class Meta:
        model = PokemonIcon
        fields = ['id', 'pokedex_number', 'display_name', 'region', 'filename']


class UserProfileSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source='user.email', read_only=True)
    trade_credit_balance = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True
    )
    pokemon_icon_id = serializers.PrimaryKeyRelatedField(
        queryset=PokemonIcon.objects.all(), source='pokemon_icon',
        required=False, allow_null=True
    )
    pokemon_icon_filename = serializers.CharField(
        source='pokemon_icon.filename', read_only=True, default=None
    )

    class Meta:
        model = UserProfile
        fields = [
            'id', 'email', 'first_name', 'last_name', 'nickname',
            'discord_id', 'discord_handle', 'no_discord',
            'trade_credit_balance',
            'pokemon_icon_id', 'pokemon_icon_filename',
        ]
        read_only_fields = ['id', 'email', 'discord_id', 'trade_credit_balance']

    def validate_first_name(self, value):
        return strip_html_chars(value)

    def validate_last_name(self, value):
        return strip_html_chars(value)

    def validate_nickname(self, value):
        return strip_html_chars(value)

    def validate_discord_handle(self, value):
        value = sanitize_plain_text(value, max_length=32)
        if value and not re.match(r'^[a-zA-Z0-9_.#-]{2,32}$', value):
            raise serializers.ValidationError(
                'Discord handle must be 2-32 characters and contain only letters, digits, underscores, dots, hyphens, or #.'
            )
        return value
