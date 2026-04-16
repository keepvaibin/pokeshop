from django.contrib import admin

from .models import BotAPIKey, PokemonIcon, User, UserProfile


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
	list_display = ('email', 'username', 'is_staff', 'is_admin')
	list_filter = ('is_staff', 'is_admin', 'is_superuser')
	search_fields = ('email', 'username')


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
	list_display = ('user', 'discord_handle', 'discord_id', 'no_discord', 'pokemon_icon')
	list_filter = ('no_discord',)
	search_fields = ('user__email', 'discord_handle', 'discord_id')


@admin.register(PokemonIcon)
class PokemonIconAdmin(admin.ModelAdmin):
	list_display = ('display_name', 'pokedex_number', 'region', 'filename')
	list_filter = ('region',)
	search_fields = ('display_name', 'filename')
	ordering = ('pokedex_number',)


@admin.register(BotAPIKey)
class BotAPIKeyAdmin(admin.ModelAdmin):
	list_display = ('name', 'key_prefix', 'is_active', 'last_used_at', 'created_at')
	list_filter = ('is_active',)
	search_fields = ('name', 'key_prefix')
	readonly_fields = ('key_prefix', 'key_hash', 'created_at', 'last_used_at')
