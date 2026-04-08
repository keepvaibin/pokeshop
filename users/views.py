import jwt
import requests
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import get_user_model
from django.conf import settings
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()

class GoogleAuthView(APIView):
    def post(self, request):
        google_token = request.data.get('token')
        if not google_token:
            return Response({'error': 'Token required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Get Google's public keys
            response = requests.get('https://www.googleapis.com/oauth2/v3/certs')
            keys = response.json()['keys']

            # Decode without verify first to get header
            header = jwt.get_unverified_header(google_token)
            kid = header['kid']

            # Find the key
            public_key = None
            for key in keys:
                if key['kid'] == kid:
                    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
                    break

            if not public_key:
                return Response({'error': 'Invalid token'}, status=status.HTTP_400_BAD_REQUEST)

            # Decode and verify
            payload = jwt.decode(google_token, public_key, algorithms=['RS256'], audience=settings.GOOGLE_CLIENT_ID, issuer='https://accounts.google.com')

            email = payload.get('email')
            hd = payload.get('hd')

            if hd != 'ucsc.edu':
                return Response({'error': 'Invalid domain'}, status=status.HTTP_403_FORBIDDEN)

            # Create or get user
            user, created = User.objects.get_or_create(email=email, defaults={'username': email.split('@')[0]})

            # Generate tokens
            refresh = RefreshToken.for_user(user)
            return Response({
                'refresh': str(refresh),
                'access': str(refresh.access_token),
                'user': {'email': user.email, 'is_admin': user.is_admin}
            })

        except jwt.ExpiredSignatureError:
            return Response({'error': 'Token expired'}, status=status.HTTP_401_UNAUTHORIZED)
        except jwt.InvalidTokenError:
            return Response({'error': 'Invalid token'}, status=status.HTTP_401_UNAUTHORIZED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
