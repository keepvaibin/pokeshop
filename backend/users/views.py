import jwt
from jwt import PyJWKClient
import requests
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth import get_user_model
from django.conf import settings
from rest_framework_simplejwt.tokens import RefreshToken
import logging

logger = logging.getLogger(__name__)

User = get_user_model()

class GoogleAuthView(APIView):
    def post(self, request):
        google_token = request.data.get('token')
        if not google_token:
            logger.error('No token provided in request')
            return Response({'error': 'Token required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            logger.info('Starting Google token verification...')
            
            jwks_url = 'https://www.googleapis.com/oauth2/v3/certs'
            jwks_client = PyJWKClient(jwks_url)
            signing_key = jwks_client.get_signing_key_from_jwt(google_token).key
            logger.info('Fetched Google signing key via PyJWKClient')

            logger.info(f'Verifying token with client_id: {settings.GOOGLE_CLIENT_ID}')
            payload = jwt.decode(
                google_token,
                signing_key,
                algorithms=['RS256'],
                audience=settings.GOOGLE_CLIENT_ID,
                issuer='https://accounts.google.com'
            )
            logger.info(f'Token verified successfully. Payload: {payload}')

            email = payload.get('email')
            hd = payload.get('hd')
            
            logger.info(f'Email: {email}, Host domain: {hd}')

            if hd != 'ucsc.edu':
                logger.warning(f'Invalid domain: {hd}')
                return Response({'error': 'Invalid domain'}, status=status.HTTP_403_FORBIDDEN)

            # Create or get user
            user, created = User.objects.get_or_create(
                email=email, 
                defaults={'username': email.split('@')[0]}
            )
            logger.info(f'User created={created}, id={user.id}, email={user.email}')

            is_admin = user.is_staff or user.email.lower() == 'vashukla@ucsc.edu'
            if is_admin and not user.is_admin:
                user.is_admin = True
                user.save(update_fields=['is_admin'])

            # Generate tokens
            refresh = RefreshToken.for_user(user)
            logger.info('Tokens generated successfully')
            
            return Response({
                'refresh': str(refresh),
                'access': str(refresh.access_token),
                'user': {'email': user.email, 'is_admin': is_admin}
            })

        except jwt.ExpiredSignatureError as e:
            logger.error(f'Token expired: {str(e)}')
            return Response({'error': 'Token expired'}, status=status.HTTP_401_UNAUTHORIZED)
        except jwt.InvalidTokenError as e:
            logger.error(f'Invalid token: {str(e)}')
            return Response({'error': 'Invalid token'}, status=status.HTTP_401_UNAUTHORIZED)
        except requests.RequestException as e:
            logger.error(f'Failed to fetch Google keys: {str(e)}')
            return Response({'error': 'Failed to verify token'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f'Unexpected error: {str(e)}', exc_info=True)
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        user = request.user
        return Response({
            'email': user.email,
            'is_admin': user.is_admin,
            'username': user.username
        })
