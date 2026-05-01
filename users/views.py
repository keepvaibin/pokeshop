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
from django.core.paginator import EmptyPage, Paginator
from django.core import signing
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, redirect
from rest_framework_simplejwt.tokens import RefreshToken
from .models import UserProfile, PokemonIcon, Strike
from .serializers import UserProfileSerializer, PokemonIconSerializer
from .permissions import IsAdminUser
from orders.item_summaries import format_order_items

User = get_user_model()


def _user_payload(user, profile):
    strike_count = user.strikes.count()
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
        'pokemon_icon': profile.pokemon_icon.filename if profile.pokemon_icon_id else None,
        'strike_count': strike_count,
        'is_restricted': strike_count >= 3,
    }


def _profile_for_user(user):
    try:
        return user.profile
    except UserProfile.DoesNotExist:
        return None


def _pokemon_icon_payload(profile):
    icon = getattr(profile, 'pokemon_icon', None) if profile else None
    if not icon:
        return None
    return {
        'id': icon.id,
        'pokedex_number': icon.pokedex_number,
        'display_name': icon.display_name,
        'region': icon.region,
        'filename': icon.filename,
    }


def _admin_user_payload(user):
    profile = _profile_for_user(user)
    first_name = getattr(profile, 'first_name', '') if profile else ''
    last_name = getattr(profile, 'last_name', '') if profile else ''
    nickname = getattr(profile, 'nickname', '') if profile else ''
    full_name = f'{first_name} {last_name}'.strip()
    display_name = nickname or full_name or user.username or user.email
    strike_count = getattr(user, 'strike_count', None)
    if strike_count is None:
        strike_count = user.strikes.count()
    current_order_count = getattr(user, 'current_order_count', 0)
    recent_order_count = getattr(user, 'recent_order_count', 0)
    trade_credit_balance = getattr(profile, 'trade_credit_balance', 0) if profile else 0
    return {
        'id': user.id,
        'email': user.email,
        'username': user.username,
        'is_admin': user.is_admin,
        'is_staff': user.is_staff,
        'is_active': user.is_active,
        'first_name': first_name,
        'last_name': last_name,
        'nickname': nickname,
        'display_name': display_name,
        'discord_id': getattr(profile, 'discord_id', None) if profile else None,
        'discord_handle': getattr(profile, 'discord_handle', '') if profile else '',
        'no_discord': getattr(profile, 'no_discord', False) if profile else False,
        'pokemon_icon': _pokemon_icon_payload(profile),
        'pokemon_icon_filename': profile.pokemon_icon.filename if profile and profile.pokemon_icon_id else None,
        'trade_credit_balance': str(trade_credit_balance or 0),
        'strike_count': strike_count,
        'is_restricted': strike_count >= 3,
        'recent_order_count': recent_order_count,
        'current_order_count': current_order_count,
        'date_joined': user.date_joined.isoformat() if user.date_joined else None,
        'last_login': user.last_login.isoformat() if user.last_login else None,
    }


def _order_items_summary(order):
    summary = format_order_items(order)
    return '' if summary == 'Unknown item' else summary


def _order_total(order):
    lines = list(order.order_items.all())
    if lines:
        return sum(line.price_at_purchase * line.quantity for line in lines)
    if order.item_id and order.item:
        return order.item.price * (order.quantity or 1)
    return 0


def _order_pickup_label(order):
    if order.pickup_date and order.recurring_timeslot_id and getattr(order, 'recurring_timeslot', None):
        readable_date = order.pickup_date.strftime('%A, %b %d').replace(' 0', ' ')
        recurring_timeslot = order.recurring_timeslot
        time_range = f'{recurring_timeslot.start_time:%I:%M} - {recurring_timeslot.end_time:%I:%M}'
        label = f'{readable_date} • {time_range}'
        return f'{label} • {recurring_timeslot.location}' if recurring_timeslot.location else label
    if order.pickup_timeslot_id and getattr(order, 'pickup_timeslot', None):
        return str(order.pickup_timeslot)
    if order.pickup_slot_id and getattr(order, 'pickup_slot', None):
        return str(order.pickup_slot)
    if order.delivery_method == 'asap':
        return 'ASAP / Downtown'
    return 'Scheduled pickup'


def _admin_order_payload(order):
    return {
        'id': order.id,
        'order_id': str(order.order_id),
        'status': order.status,
        'status_label': order.get_status_display(),
        'payment_method': order.payment_method,
        'payment_label': order.get_payment_method_display(),
        'delivery_method': order.delivery_method,
        'delivery_label': order.get_delivery_method_display(),
        'pickup_label': _order_pickup_label(order),
        'items_summary': _order_items_summary(order),
        'total': str(_order_total(order)),
        'discount_applied': str(order.discount_applied or 0),
        'store_credit_applied': str(order.store_credit_applied or 0),
        'created_at': order.created_at.isoformat() if order.created_at else None,
        'updated_at': order.updated_at.isoformat() if order.updated_at else None,
    }


def _strike_payload(strike):
    return {
        'id': strike.id,
        'reason': strike.reason,
        'given_by_id': strike.given_by_id,
        'given_by_email': strike.given_by.email if strike.given_by else None,
        'acknowledged': strike.acknowledged,
        'created_at': strike.created_at.isoformat() if strike.created_at else None,
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
        request_data = request.data.copy()
        disconnect_discord = _boolish(request_data.get('disconnect_discord'))
        request_data.pop('disconnect_discord', None)
        serializer = UserProfileSerializer(profile, data=request_data, partial=True)
        serializer.is_valid(raise_exception=True)
        if 'no_discord' in request_data and _boolish(request_data.get('no_discord')):
            serializer.save(discord_handle='', discord_id=None, no_discord=True)
        elif disconnect_discord:
            serializer.save(discord_handle='', discord_id=None, no_discord=False)
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


class PokemonIconListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        qs = PokemonIcon.objects.all()
        region = request.query_params.get('region')
        if region:
            qs = qs.filter(region__iexact=region)
        search = request.query_params.get('search')
        if search:
            qs = qs.filter(display_name__icontains=search)
        serializer = PokemonIconSerializer(qs, many=True)
        resp = Response(serializer.data)
        resp['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp


# ---------------------------------------------------------------------------
# Strike management
# ---------------------------------------------------------------------------

class AdminUsersListView(APIView):
    """Admin-only: paginated user cards for the admin Users page."""
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        from orders.models import Order

        search = (request.query_params.get('search') or request.query_params.get('q') or '').strip()
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.query_params.get('page_size', 48))
        except (TypeError, ValueError):
            page_size = 48
        page_size = min(max(page_size, 1), 100)

        users = (
            User.objects
            .select_related('profile__pokemon_icon')
            .annotate(
                strike_count=Count('strikes', distinct=True),
                recent_order_count=Count('order', distinct=True),
                current_order_count=Count(
                    'order',
                    filter=Q(order__status__in=Order.ACTIVE_ORDER_STATUSES),
                    distinct=True,
                ),
            )
            .order_by('-date_joined', 'email')
        )
        if search:
            users = users.filter(
                Q(email__icontains=search)
                | Q(username__icontains=search)
                | Q(profile__first_name__icontains=search)
                | Q(profile__last_name__icontains=search)
                | Q(profile__nickname__icontains=search)
                | Q(profile__discord_handle__icontains=search)
                | Q(profile__discord_id__icontains=search)
            ).distinct()

        paginator = Paginator(users, page_size)
        if paginator.count == 0:
            return Response({
                'count': 0,
                'page': 1,
                'page_size': page_size,
                'total_pages': 0,
                'results': [],
            })

        page = min(page, paginator.num_pages)
        try:
            page_obj = paginator.page(page)
        except EmptyPage:
            page_obj = paginator.page(paginator.num_pages)

        return Response({
            'count': paginator.count,
            'page': page_obj.number,
            'page_size': page_size,
            'total_pages': paginator.num_pages,
            'results': [_admin_user_payload(user) for user in page_obj.object_list],
        })


class AdminUserDetailView(APIView):
    """Admin-only: full account panel data for one user."""
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request, pk):
        from orders.models import Order
        from trade_ins.models import CreditLedger

        user = get_object_or_404(
            User.objects.select_related('profile__pokemon_icon').annotate(
                strike_count=Count('strikes', distinct=True),
                recent_order_count=Count('order', distinct=True),
                current_order_count=Count(
                    'order',
                    filter=Q(order__status__in=Order.ACTIVE_ORDER_STATUSES),
                    distinct=True,
                ),
            ),
            pk=pk,
        )

        order_base = (
            Order.objects
            .filter(user=user)
            .select_related('item', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot')
            .prefetch_related('order_items__item')
        )
        recent_orders = order_base.order_by('-created_at')[:5]
        current_orders = order_base.filter(status__in=Order.ACTIVE_ORDER_STATUSES).order_by('-created_at')[:10]
        strikes = Strike.objects.filter(user=user).select_related('given_by')[:20]
        recent_credit = CreditLedger.objects.filter(user=user).select_related('created_by')[:10]

        return Response({
            'user': _admin_user_payload(user),
            'recent_orders': [_admin_order_payload(order) for order in recent_orders],
            'current_orders': [_admin_order_payload(order) for order in current_orders],
            'strikes': [_strike_payload(strike) for strike in strikes],
            'recent_credit_ledger': [
                {
                    'id': entry.id,
                    'amount': str(entry.amount),
                    'transaction_type': entry.transaction_type,
                    'reference_id': entry.reference_id,
                    'note': entry.note,
                    'created_by_id': entry.created_by_id,
                    'created_by_email': entry.created_by.email if entry.created_by else None,
                    'created_at': entry.created_at.isoformat() if entry.created_at else None,
                }
                for entry in recent_credit
            ],
        })

class SearchUsersView(APIView):
    """Admin-only: search users by email, name, nickname, or discord handle."""
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        from django.db.models import Q

        q = (request.query_params.get('q') or '').strip()
        if len(q) < 2:
            return Response([])

        users = User.objects.filter(
            Q(email__icontains=q)
            | Q(username__icontains=q)
            | Q(profile__first_name__icontains=q)
            | Q(profile__last_name__icontains=q)
            | Q(profile__nickname__icontains=q)
            | Q(profile__discord_handle__icontains=q)
        ).distinct()[:20]

        results = []
        for u in users:
            profile = getattr(u, 'profile', None)
            display = u.email
            if profile and profile.nickname:
                display = f"{profile.nickname} ({u.email})"
            elif profile and profile.first_name:
                display = f"{profile.first_name} ({u.email})"
            results.append({'id': u.id, 'email': u.email, 'display': display})
        return Response(results)


class UsersWithStrikesView(APIView):
    """Admin-only: list users who have at least one strike."""
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        from django.db.models import Count

        users = (
            User.objects.annotate(strike_count=Count('strikes'))
            .filter(strike_count__gt=0)
            .order_by('-strike_count')
        )
        data = [
            {
                'id': u.id,
                'email': u.email,
                'username': u.username,
                'strike_count': u.strike_count,
            }
            for u in users
        ]
        return Response(data)


class StrikeListCreateDeleteView(APIView):
    """
    Admin-only:
      GET  ?user_id=N  — list strikes for a user
      POST {user_id, reason} — issue a new strike
      DELETE /<pk>/     — (handled via URL) remove a strike
    """
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        user_id = request.query_params.get('user_id')
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        strikes = Strike.objects.filter(user_id=user_id).select_related('given_by')
        data = [
            {
                'id': s.id,
                'user_id': s.user_id,
                'user_email': s.user.email,
                'reason': s.reason,
                'given_by_email': s.given_by.email if s.given_by else None,
                'acknowledged': s.acknowledged,
                'created_at': s.created_at.isoformat(),
            }
            for s in strikes
        ]
        return Response(data)

    def post(self, request):
        user_id = request.data.get('user_id')
        reason = (request.data.get('reason') or '').strip()
        if not user_id or not reason:
            return Response({'error': 'user_id and reason are required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        strike = Strike.objects.create(user=target_user, reason=reason, given_by=request.user)
        total = target_user.strikes.count()
        return Response({'id': strike.id, 'total_strikes': total}, status=status.HTTP_201_CREATED)


class StrikeDeleteView(APIView):
    """Admin-only: delete a specific strike."""
    permission_classes = [IsAuthenticated, IsAdminUser]

    def delete(self, request, pk):
        try:
            strike = Strike.objects.get(pk=pk)
        except Strike.DoesNotExist:
            return Response({'error': 'Strike not found'}, status=status.HTTP_404_NOT_FOUND)
        strike.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyStrikesView(APIView):
    """
    Authenticated user:
      GET  — returns unacknowledged strikes for the current user
      POST {strike_id} — acknowledge a strike
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        unacked = Strike.objects.filter(user=request.user, acknowledged=False)
        data = [
            {'id': s.id, 'reason': s.reason, 'created_at': s.created_at.isoformat()}
            for s in unacked
        ]
        return Response({'unacknowledged': data})

    def post(self, request):
        strike_id = request.data.get('strike_id')
        if not strike_id:
            return Response({'error': 'strike_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            strike = Strike.objects.get(pk=strike_id, user=request.user)
        except Strike.DoesNotExist:
            return Response({'error': 'Strike not found'}, status=status.HTTP_404_NOT_FOUND)
        strike.acknowledged = True
        strike.save(update_fields=['acknowledged'])
        return Response({'acknowledged': True})
