from rest_framework.permissions import BasePermission

from .models import BotAPIKey


class IsAdminUser(BasePermission):
    message = 'Admin access required.'

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and request.user.is_admin


class HasBotAPIKey(BasePermission):
    message = 'Valid bot API key required.'

    def has_permission(self, request, view):
        raw_key = (
            request.headers.get('X-SCTCG-Bot-API-Key')
            or request.headers.get('X-Bot-API-Key')
            or ''
        ).strip()
        if not raw_key:
            return False

        api_key = BotAPIKey.objects.filter(key_prefix=raw_key[:12], is_active=True).first()
        if not api_key or not api_key.check_key(raw_key):
            return False

        request.bot_api_key = api_key
        return True