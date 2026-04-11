import jwt
from jwt import PyJWKClient
import requests
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from django.contrib.auth import get_user_model
from django.conf import settings
from rest_framework_simplejwt.tokens import RefreshToken
from .models import UserProfile
from .serializers import UserProfileSerializer

User = get_user_model()


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
                'user': {
                    'email': user.email,
                    'is_admin': is_admin,
                    'username': user.username,
                    'discord_handle': profile.discord_handle,
                    'no_discord': profile.no_discord,
                    'first_name': profile.first_name,
                    'last_name': profile.last_name,
                    'nickname': profile.nickname,
                },
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
        return Response({
            'email': user.email,
            'is_admin': user.is_admin,
            'username': user.username,
            'discord_handle': profile.discord_handle,
            'no_discord': profile.no_discord,
            'first_name': profile.first_name,
            'last_name': profile.last_name,
            'nickname': profile.nickname,
        })


class UpdateProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


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
            'user': {
                'email': user.email,
                'is_admin': user.is_admin,
                'username': user.username,
                'discord_handle': profile.discord_handle,
                'no_discord': profile.no_discord,
                'first_name': profile.first_name,
                'last_name': profile.last_name,
                'nickname': profile.nickname,
            },
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
            'user': {
                'email': user.email,
                'is_admin': user.is_admin,
                'username': user.username,
                'discord_handle': profile.discord_handle,
                'no_discord': profile.no_discord,
                'first_name': profile.first_name,
                'last_name': profile.last_name,
                'nickname': profile.nickname,
            },
        })
