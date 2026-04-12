import jwt
from jwt import PyJWKClient
import requests
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from django.contrib.auth import get_user_model
from django.conf import settings
from django.core import signing
from django.shortcuts import redirect
from rest_framework_simplejwt.tokens import RefreshToken
from .models import UserProfile
from .serializers import UserProfileSerializer

User = get_user_model()


def _user_payload(user, profile):
    return {
        'email': user.email,
        'is_admin': user.is_admin,
        'username': user.username,
        'discord_id': profile.discord_id,
        'discord_handle': profile.discord_handle,
        'no_discord': profile.no_discord,
        'first_name': profile.first_name,
        'last_name': profile.last_name,
        'nickname': profile.nickname,
    }


def _boolish(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {'1', 'true', 'yes', 'on'}
    return bool(value)


def _discord_display_name(discord_user: dict) -> str:
    global_name = (discord_user.get('global_name') or '').strip()
    if global_name:
        return global_name

    username = (discord_user.get('username') or '').strip()
    discriminator = str(discord_user.get('discriminator') or '').strip()
    if username and discriminator and discriminator != '0':
        return f'{username}#{discriminator}'
    return username


def _normalize_frontend_path(path: str) -> str:
    if not path or not path.startswith('/'):
        return '/settings'
    return path


def _frontend_redirect(path: str, state: str, detail: str = ''):
    normalized_path = _normalize_frontend_path(path)
    split = urlsplit(normalized_path)
    query = dict(parse_qsl(split.query, keep_blank_values=True))
    query['discord'] = state
    if detail:
        query['detail'] = detail

    target_path = urlunsplit(('', '', split.path, urlencode(query), ''))
    return redirect(f"{settings.FRONTEND_URL.rstrip('/')}{target_path}")


class AuthAnonThrottle(AnonRateThrottle):
    scope = 'auth_anon'


class AuthUserThrottle(UserRateThrottle):
    scope = 'auth_user'

class GoogleAuthView(APIView):
    def post(self, request):
        google_token = request.data.get('credential') or request.data.get('token')
        if not google_token:
            return Response({'error': 'Token required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            jwks_url = 'https://www.googleapis.com/oauth2/v3/certs'
            jwks_client = PyJWKClient(jwks_url)
            signing_key = jwks_client.get_signing_key_from_jwt(google_token).key

            payload = jwt.decode(
                google_token,
                signing_key,
                algorithms=['RS256'],
                audience=settings.GOOGLE_CLIENT_ID,
                issuer='https://accounts.google.com'
            )

            email = payload.get('email')
            hd = payload.get('hd')

            if hd != 'ucsc.edu':
                return Response({'error': 'Invalid domain'}, status=status.HTTP_403_FORBIDDEN)

            # Create or get user
            user, created = User.objects.get_or_create(
                email=email, 
                defaults={'username': email.split('@')[0]}
            )

            is_admin = user.is_staff or user.email.lower() == 'vashukla@ucsc.edu'
            if is_admin and not user.is_admin:
                user.is_admin = True
                user.save(update_fields=['is_admin'])

            # Auto-create profile
            profile, _ = UserProfile.objects.get_or_create(user=user)

            # Generate tokens
            refresh = RefreshToken.for_user(user)
            
            return Response({
                'refresh': str(refresh),
                'access': str(refresh.access_token),
                'user': _user_payload(user, profile) | {'is_admin': is_admin},
            })

        except jwt.ExpiredSignatureError:
            return Response({'error': 'Token expired'}, status=status.HTTP_401_UNAUTHORIZED)
        except jwt.InvalidTokenError:
            return Response({'error': 'Invalid token'}, status=status.HTTP_401_UNAUTHORIZED)
        except requests.RequestException:
            return Response({'error': 'Failed to verify token'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        user = request.user
        profile, _ = UserProfile.objects.get_or_create(user=user)
        return Response(_user_payload(user, profile))


class UpdateProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if 'no_discord' in request.data and _boolish(request.data.get('no_discord')):
            serializer.save(discord_handle='', discord_id=None, no_discord=True)
        else:
            serializer.save()
        return Response(serializer.data)


class DiscordOAuthInitiateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not settings.DISCORD_CLIENT_ID or not settings.DISCORD_CLIENT_SECRET:
            return Response({'error': 'Discord OAuth is not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        next_path = request.query_params.get('next') or '/settings'
        state = signing.dumps({'user_id': request.user.id, 'next': next_path}, salt='discord-oauth-state')
        authorize_query = urlencode({
            'client_id': settings.DISCORD_CLIENT_ID,
            'redirect_uri': settings.DISCORD_OAUTH_REDIRECT_URI,
            'response_type': 'code',
            'scope': 'identify',
            'prompt': 'consent',
            'state': state,
        })
        return Response({'authorization_url': f'https://discord.com/oauth2/authorize?{authorize_query}'})


class DiscordOAuthCallbackView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        state = request.query_params.get('state', '')
        error = request.query_params.get('error', '')
        code = request.query_params.get('code', '')

        if not state:
            return _frontend_redirect('/settings', 'error', 'Missing Discord OAuth state.')

        try:
            state_data = signing.loads(state, salt='discord-oauth-state', max_age=600)
        except signing.BadSignature:
            return _frontend_redirect('/settings', 'error', 'Invalid or expired Discord OAuth state.')

        next_path = state_data.get('next') or '/settings'

        if error:
            return _frontend_redirect(next_path, 'cancelled', 'Discord authorization was cancelled.')

        if not settings.DISCORD_CLIENT_ID or not settings.DISCORD_CLIENT_SECRET:
            return _frontend_redirect(next_path, 'error', 'Discord OAuth is not configured.')

        if not code:
            return _frontend_redirect(next_path, 'error', 'Missing Discord authorization code.')

        try:
            token_response = requests.post(
                'https://discord.com/api/oauth2/token',
                data={
                    'client_id': settings.DISCORD_CLIENT_ID,
                    'client_secret': settings.DISCORD_CLIENT_SECRET,
                    'grant_type': 'authorization_code',
                    'code': code,
                    'redirect_uri': settings.DISCORD_OAUTH_REDIRECT_URI,
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=10,
            )
            token_response.raise_for_status()
            access_token = token_response.json().get('access_token')
            if not access_token:
                raise ValueError('Discord did not return an access token.')

            user_response = requests.get(
                'https://discord.com/api/users/@me',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10,
            )
            user_response.raise_for_status()
            discord_user = user_response.json()
        except (requests.RequestException, ValueError):
            return _frontend_redirect(next_path, 'error', 'Failed to verify the Discord account.')

        discord_id = str(discord_user.get('id') or '').strip()
        if not discord_id:
            return _frontend_redirect(next_path, 'error', 'Discord did not return a valid user ID.')

        try:
            user = User.objects.get(pk=state_data['user_id'])
        except User.DoesNotExist:
            return _frontend_redirect(next_path, 'error', 'The linked user account no longer exists.')

        profile, _ = UserProfile.objects.get_or_create(user=user)
        if UserProfile.objects.filter(discord_id=discord_id).exclude(pk=profile.pk).exists():
            return _frontend_redirect(next_path, 'error', 'That Discord account is already linked to another user.')

        profile.discord_id = discord_id
        profile.discord_handle = _discord_display_name(discord_user)
        profile.no_discord = False
        profile.save(update_fields=['discord_id', 'discord_handle', 'no_discord'])
        return _frontend_redirect(next_path, 'linked')


class ValidateAccessCodeView(APIView):
    """Public endpoint to validate an access code exists and is usable."""
    permission_classes = [AllowAny]
    throttle_classes = [AuthAnonThrottle]

    def post(self, request):
        from inventory.models import AccessCode
        code = (request.data.get('code') or '').strip().upper()
        if not code:
            return Response({'error': 'Access code is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ac = AccessCode.objects.get(code__iexact=code)
        except AccessCode.DoesNotExist:
            return Response({'error': 'Invalid access code.'}, status=status.HTTP_404_NOT_FOUND)
        if not ac.is_valid:
            return Response({'error': 'This access code has expired or reached its usage limit.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'valid': True, 'code': ac.code})


class RegisterWithAccessCodeView(APIView):
    """Register a non-UCSC user with an access code + email + password."""
    permission_classes = [AllowAny]
    throttle_classes = [AuthAnonThrottle]

    def post(self, request):
        from inventory.models import AccessCode
        from django.db import models as db_models

        code = (request.data.get('access_code') or '').strip().upper()
        email = (request.data.get('email') or '').strip().lower()
        password = request.data.get('password', '')
        username = request.data.get('username', '').strip()

        if not all([code, email, password]):
            return Response({'error': 'access_code, email, and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

        if len(password) < 8:
            return Response({'error': 'Password must be at least 8 characters.'}, status=status.HTTP_400_BAD_REQUEST)

        # Validate access code
        try:
            ac = AccessCode.objects.get(code__iexact=code)
        except AccessCode.DoesNotExist:
            return Response({'error': 'Invalid access code.'}, status=status.HTTP_400_BAD_REQUEST)
        if not ac.is_valid:
            return Response({'error': 'This access code has expired or reached its usage limit.'}, status=status.HTTP_400_BAD_REQUEST)

        # Check if email already exists
        if User.objects.filter(email=email).exists():
            return Response({'error': 'An account with this email already exists.'}, status=status.HTTP_400_BAD_REQUEST)

        # Create user - UCSC email validator removed from model field so any email works
        if not username:
            username = email.split('@')[0]
        user = User(email=email, username=username)
        user.set_password(password)
        user.save()

        # Create profile with optional fields
        profile = UserProfile.objects.create(
            user=user,
            first_name=request.data.get('first_name', '').strip(),
            last_name=request.data.get('last_name', '').strip(),
            nickname=request.data.get('nickname', '').strip(),
            discord_handle=request.data.get('discord_handle', '').strip(),
            no_discord=bool(request.data.get('no_discord', False)),
        )

        # Increment access code usage
        AccessCode.objects.filter(id=ac.id).update(times_used=db_models.F('times_used') + 1)

        # Generate JWT tokens
        refresh = RefreshToken.for_user(user)
        return Response({
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'user': _user_payload(user, profile),
        }, status=status.HTTP_201_CREATED)


class EmailLoginView(APIView):
    """Login with email + password for non-UCSC users registered via access code."""
    permission_classes = [AllowAny]
    throttle_classes = [AuthAnonThrottle]

    def post(self, request):
        from django.contrib.auth import authenticate

        email = (request.data.get('email') or '').strip().lower()
        password = request.data.get('password', '')

        if not email or not password:
            return Response({'error': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

        user = authenticate(request, username=email, password=password)
        if user is None:
            return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        refresh = RefreshToken.for_user(user)
        profile, _ = UserProfile.objects.get_or_create(user=user)
        return Response({
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'user': _user_payload(user, profile),
        })
