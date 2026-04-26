import requests as _requests
import time as _time
import re as _re
import logging
from datetime import timedelta as _timedelta
from decimal import Decimal as _Decimal, ROUND_DOWN as _ROUND_DOWN
from urllib.parse import quote_plus as _quote_plus
from requests import RequestException as RequestsRequestException
from rest_framework import generics, permissions, viewsets, status
from rest_framework.decorators import api_view, permission_classes as perm_classes_decorator
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Count, Max, Prefetch, Q
from django.utils import timezone as tz

_SETS_CACHE: dict = {'data': None, 'ts': 0.0}
logger = logging.getLogger(__name__)

from .models import (
    Item, ItemImage, WantedCard, PickupSlot, PokeshopSettings,
    PickupTimeslot, RecurringTimeslot, TCGCardPrice, AccessCode,
    InventoryDrop, Category, SubCategory, PromoBanner, HomepageSection,
)
from .serializers import (
    ItemSerializer, WantedCardSerializer, PickupSlotSerializer,
    PokeshopSettingsSerializer, PickupTimeslotSerializer, RecurringTimeslotSerializer,
    TCGCardPriceSerializer, AccessCodeSerializer, InventoryDropSerializer,
    CategorySerializer, SubCategorySerializer, PromoBannerSerializer, HomepageSectionSerializer,
)


def _coerce_boolish(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return bool(value)
    normalized = str(value).strip().lower()
    if normalized in {'true', '1', 'yes', 'on'}:
        return True
    if normalized in {'false', '0', 'no', 'off', ''}:
        return False
    return None


def _save_with_full_clean(serializer):
    from django.db import transaction as db_transaction
    from django.core.exceptions import ValidationError as DjangoValidationError
    from rest_framework.exceptions import ValidationError as DRFValidationError

    try:
        with db_transaction.atomic():
            instance = serializer.save()
            instance.full_clean()
    except DjangoValidationError as e:
        raise DRFValidationError(e.message_dict if hasattr(e, 'message_dict') else e.messages)


class IsStaffOrAdminEmail(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return user.is_staff or user.email.lower() == 'vashukla@ucsc.edu'


import logging as _logging
_logger = _logging.getLogger(__name__)


def _flag_orders_for_deleted_timeslot(lookup: dict, slot_label: str):
    from orders.models import Order
    from orders.services import send_discord_dm
    from django.conf import settings

    RESCHEDULE_DAYS = 3
    deadline = tz.now() + _timedelta(days=RESCHEDULE_DAYS)

    affected = Order.objects.filter(
        status__in=Order.ACTIVE_ORDER_STATUSES,
        **lookup,
    ).select_related('user', 'item')

    for order in affected:
        order.requires_rescheduling = True
        order.reschedule_deadline = deadline
        order.save(update_fields=['requires_rescheduling', 'reschedule_deadline'])

        frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
        send_discord_dm(
            user=order.user,
            title='Timeslot Cancelled - Action Required',
            description=(
                f'Your pickup timeslot **{slot_label}** for order **{order.item.title}** '
                f'has been cancelled by the store. Please select a new timeslot '
                f'before **{deadline.strftime("%b %d, %Y")}** or your order will be cancelled.'
            ),
            color=0xF59E0B,
            url=f'{frontend_url}/orders/{order.order_id}',
            button={'label': 'Reschedule Now', 'url': f'{frontend_url}/orders/{order.order_id}'},
        )
        _logger.info('Flagged order %s for rescheduling (timeslot deleted: %s)', order.pk, slot_label)


def _build_recurring_booking_counts(timeslots):
    from orders.models import Order

    timeslots = list(timeslots)
    if not timeslots:
        return {}

    booking_filters = Q()
    for timeslot in timeslots:
        booking_filters |= Q(
            recurring_timeslot_id=timeslot.id,
            pickup_date=timeslot.next_pickup_date(),
        )

    rows = Order.objects.filter(
        booking_filters,
        status__in=Order.ACTIVE_SLOT_STATUSES,
    ).values('recurring_timeslot_id', 'pickup_date').annotate(total=Count('id'))

    return {
        (row['recurring_timeslot_id'], row['pickup_date']): row['total']
        for row in rows
    }


class ItemViewSet(viewsets.ModelViewSet):
    serializer_class = ItemSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    lookup_field = 'slug'

    def get_queryset(self):
        # Process any overdue inventory drops before returning results
        if self.action in ('list', 'retrieve'):
            process_pending_drops()

        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            qs = Item.objects.select_related('category', 'subcategory').prefetch_related(
                'tags', 'images', 'scheduled_drops'
            ).all()
        else:
            qs = Item.objects.select_related('category', 'subcategory').prefetch_related(
                'tags', 'images', 'scheduled_drops'
            ).filter(
                is_active=True
            ).filter(
                Q(stock__gt=0) | Q(show_when_out_of_stock=True)
            ).filter(
                Q(published_at__lte=tz.now()) | Q(preview_before_release=True, published_at__isnull=False)
            )

        params = self.request.query_params

        # Category filter by slug (multi-value supported for search: ?category=cards&category=boxes)
        category_slugs = [slug.strip() for slug in params.getlist('category') if slug.strip()]
        if category_slugs:
            qs = qs.filter(category__slug__in=category_slugs)

        # Subcategory filter by slug
        subcategory_slug = params.get('subcategory', '').strip()
        if subcategory_slug:
            qs = qs.filter(subcategory__slug=subcategory_slug)

        # Tag filter by slug (custom categories)
        tag_slugs = [slug.strip() for slug in params.getlist('tag') if slug.strip()]
        if tag_slugs:
            qs = qs.filter(tags__slug__in=tag_slugs)

        # TCG facet filters (multi-value supported: ?tcg_type=Fire&tcg_type=Water)
        tcg_types = params.getlist('tcg_type')
        if tcg_types:
            qs = qs.filter(tcg_type__in=tcg_types)

        tcg_stages = params.getlist('tcg_stage')
        if tcg_stages:
            qs = qs.filter(tcg_stage__in=tcg_stages)

        rarity_types = params.getlist('rarity_type')
        if rarity_types:
            qs = qs.filter(rarity_type__in=rarity_types)

        # Deep TCG facet filters
        tcg_supertypes = params.getlist('tcg_supertype')
        if tcg_supertypes:
            qs = qs.filter(tcg_supertype__in=tcg_supertypes)

        tcg_set_names = params.getlist('tcg_set_name')
        if tcg_set_names:
            qs = qs.filter(tcg_set_name__in=tcg_set_names)

        tcg_artists = params.getlist('tcg_artist')
        if tcg_artists:
            qs = qs.filter(tcg_artist__in=tcg_artists)

        # Save queryset before price filters for dynamic price_max
        self._qs_before_price = qs

        # Price range filter
        min_price = params.get('min_price', '').strip()
        max_price = params.get('max_price', '').strip()
        if min_price:
            try:
                qs = qs.filter(price__gte=min_price)
            except Exception:
                pass
        if max_price:
            try:
                qs = qs.filter(price__lte=max_price)
            except Exception:
                pass

        # Full-text search
        q = params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(title__icontains=q) |
                Q(short_description__icontains=q) |
                Q(tcg_set_name__icontains=q) |
                Q(rarity_type__icontains=q) |
                Q(rarity__icontains=q) |
                Q(tcg_type__icontains=q) |
                Q(tcg_supertype__icontains=q) |
                Q(tcg_artist__icontains=q) |
                Q(tags__name__icontains=q)
            )

        if tag_slugs or q:
            qs = qs.distinct()

        # Sorting
        sort = params.get('sort', '').strip()
        if sort == 'newest':
            qs = qs.order_by('-created_at')
        elif sort == 'price-low':
            qs = qs.order_by('price')
        elif sort == 'price-high':
            qs = qs.order_by('-price')
        elif sort == 'name':
            qs = qs.order_by('title')
        elif sort == 'release-asc':
            qs = qs.order_by('tcg_set_release_date')
        elif sort == 'release-desc':
            qs = qs.order_by('-tcg_set_release_date')

        return qs

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        qs_before_price = getattr(self, '_qs_before_price', None)
        if qs_before_price is not None:
            agg = qs_before_price.aggregate(price_max=Max('price'))
            response.data['price_max'] = float(agg['price_max'] or 0)
        return response

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

    def perform_update(self, serializer):
        item = serializer.instance
        requested_is_active = None
        requested_show_oos = None
        if 'is_active' in self.request.data:
            requested_is_active = _coerce_boolish(self.request.data.get('is_active'))
        if 'show_when_out_of_stock' in self.request.data:
            requested_show_oos = _coerce_boolish(self.request.data.get('show_when_out_of_stock'))

        logger.info(
            (
                'Item update requested: slug=%s id=%s user_id=%s '
                'validated_data=%s raw_is_active=%s raw_show_when_out_of_stock=%s'
            ),
            getattr(item, 'slug', None),
            getattr(item, 'id', None),
            getattr(getattr(self.request, 'user', None), 'id', None),
            serializer.validated_data,
            self.request.data.get('is_active') if 'is_active' in self.request.data else None,
            self.request.data.get('show_when_out_of_stock') if 'show_when_out_of_stock' in self.request.data else None,
        )

        serializer.save()
        serializer.instance.refresh_from_db()

        # Defensive reconciliation for production-only drift on legacy items.
        # If the client explicitly requested visibility booleans and they were not
        # persisted by serializer.save(), enforce them directly and log the mismatch.
        forced_updates = {}
        if requested_is_active is not None and serializer.instance.is_active != requested_is_active:
            forced_updates['is_active'] = requested_is_active
        if requested_show_oos is not None and serializer.instance.show_when_out_of_stock != requested_show_oos:
            forced_updates['show_when_out_of_stock'] = requested_show_oos

        if forced_updates:
            logger.warning(
                'Item update mismatch detected; forcing fields: slug=%s id=%s forced_updates=%s',
                serializer.instance.slug,
                serializer.instance.id,
                forced_updates,
            )
            Item.objects.filter(pk=serializer.instance.pk).update(**forced_updates)
            serializer.instance.refresh_from_db()

        logger.info(
            'Item update saved: slug=%s id=%s is_active=%s show_when_out_of_stock=%s stock=%s published_at=%s',
            serializer.instance.slug,
            serializer.instance.id,
            serializer.instance.is_active,
            serializer.instance.show_when_out_of_stock,
            serializer.instance.stock,
            serializer.instance.published_at,
        )


class ItemByIdView(generics.RetrieveAPIView):
    """Retrieve a single item by numeric PK (used by checkout / cart)."""
    serializer_class = ItemSerializer

    def get_queryset(self):
        return Item.objects.filter(is_active=True).select_related('category', 'subcategory').prefetch_related(
            'images', 'scheduled_drops', 'tags'
        )


class ItemFacetsView(APIView):
    """Return distinct set names and artists from published items, optionally scoped by category."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        qs = Item.objects.filter(
            is_active=True
        ).filter(
            Q(stock__gt=0) | Q(show_when_out_of_stock=True)
        ).filter(
            Q(published_at__lte=tz.now()) | Q(preview_before_release=True, published_at__isnull=False)
        )
        category_slugs = [s.strip() for s in request.query_params.getlist('category') if s.strip()]
        if category_slugs:
            qs = qs.filter(category__slug__in=category_slugs)

        sets = list(
            qs.exclude(tcg_set_name__isnull=True).exclude(tcg_set_name='')
            .values_list('tcg_set_name', flat=True).distinct().order_by('tcg_set_name')
        )
        artists = list(
            qs.exclude(tcg_artist__isnull=True).exclude(tcg_artist='')
            .values_list('tcg_artist', flat=True).distinct().order_by('tcg_artist')
        )
        return Response({'sets': sets, 'artists': artists})


class WantedCardViewSet(viewsets.ModelViewSet):
    serializer_class = WantedCardSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    lookup_field = 'slug'

    def get_queryset(self):
        qs = WantedCard.objects.select_related('tcg_card').prefetch_related('images').order_by('-id')
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return qs.all()
        return qs.filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


class PickupSlotViewSet(viewsets.ModelViewSet):
    queryset = PickupSlot.objects.filter(is_claimed=False)
    serializer_class = PickupSlotSerializer


class PokeshopSettingsView(viewsets.ViewSet):
    """Singleton settings - GET for anyone, PATCH for admins only."""

    def list(self, request):
        settings_obj = PokeshopSettings.load()
        if (settings_obj.store_announcement
                and settings_obj.announcement_expires_at
                and settings_obj.announcement_expires_at <= tz.now()):
            settings_obj.store_announcement = ''
            settings_obj.announcement_expires_at = None
            settings_obj.save(update_fields=['store_announcement', 'announcement_expires_at'])
        return Response(PokeshopSettingsSerializer(settings_obj).data)

    def partial_update(self, request, pk=None):
        if not (request.user.is_authenticated and (request.user.is_staff or getattr(request.user, 'is_admin', False))):
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        settings_obj = PokeshopSettings.load()
        serializer = PokeshopSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PickupTimeslotViewSet(viewsets.ModelViewSet):
    serializer_class = PickupTimeslotSerializer

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return PickupTimeslot.objects.all()
        # Public users only see available future timeslots
        from django.utils import timezone
        return PickupTimeslot.objects.filter(is_active=True, start__gt=timezone.now())

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

    def perform_create(self, serializer):
        _save_with_full_clean(serializer)

    def perform_update(self, serializer):
        _save_with_full_clean(serializer)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        _flag_orders_for_deleted_timeslot(
            lookup={'pickup_timeslot': instance},
            slot_label=str(instance),
        )
        return super().destroy(request, *args, **kwargs)


class RecurringTimeslotViewSet(viewsets.ModelViewSet):
    serializer_class = RecurringTimeslotSerializer

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return RecurringTimeslot.objects.all()
        return RecurringTimeslot.objects.filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

    def perform_create(self, serializer):
        _save_with_full_clean(serializer)

    def perform_update(self, serializer):
        _save_with_full_clean(serializer)

    def _serializer_context_for(self, timeslots):
        context = super().get_serializer_context()
        context['recurring_booking_counts'] = _build_recurring_booking_counts(timeslots)
        return context

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        page = self.paginate_queryset(queryset)
        timeslots = list(page if page is not None else queryset)
        serializer = self.get_serializer(
            timeslots,
            many=True,
            context=self._serializer_context_for(timeslots),
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(
            instance,
            context=self._serializer_context_for([instance]),
        )
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        _flag_orders_for_deleted_timeslot(
            lookup={'recurring_timeslot': instance},
            slot_label=str(instance),
        )
        return super().destroy(request, *args, **kwargs)


class AccessCodeViewSet(viewsets.ModelViewSet):
    """Admin-only CRUD for access codes."""
    serializer_class = AccessCodeSerializer
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get_queryset(self):
        return AccessCode.objects.all().order_by('-created_at')


class InventoryDropViewSet(viewsets.ModelViewSet):
    """Admin CRUD for scheduled inventory drops."""
    serializer_class = InventoryDropSerializer
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get_queryset(self):
        qs = InventoryDrop.objects.all()
        item_id = self.request.query_params.get('item')
        if item_id:
            qs = qs.filter(item_id=item_id)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_processed:
            return Response({'error': 'Cannot delete an already-processed drop.'}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


def process_pending_drops():
    """Execute all overdue inventory drops atomically."""
    from django.db import transaction
    from django.db.models import F
    now = tz.now()
    pending = InventoryDrop.objects.filter(drop_time__lte=now, is_processed=False).select_related('item')
    for drop in pending:
        with transaction.atomic():
            Item.objects.filter(pk=drop.item_id).update(stock=F('stock') + drop.quantity)
            drop.is_processed = True
            drop.save(update_fields=['is_processed'])


def _round_card_market_price(value: _Decimal) -> _Decimal:
    """Apply pricing workflow rule:
    >= $1.00 -> floor to whole dollar, otherwise keep cent precision.
    """
    if value >= _Decimal('1.00'):
        return value.to_integral_value(rounding=_ROUND_DOWN)
    return value.quantize(_Decimal('0.01'), rounding=_ROUND_DOWN)


def _resolve_trade_price_entry_for_item(item):
    """Resolve a TCGCardPrice row for a card Item when possible."""
    # For imported trade IDs, use the product id directly.
    if item.api_id and item.api_id.startswith('trade-'):
        parts = item.api_id.split('-')
        if len(parts) > 1 and parts[1].isdigit():
            product_id = int(parts[1])
            qs = TCGCardPrice.objects.filter(product_id=product_id, market_price__isnull=False)
            subtype_hint = (item.tcg_subtypes or '').split(',')[0].strip()
            if subtype_hint:
                subtype_match = qs.filter(sub_type_name__icontains=subtype_hint).order_by('-updated_at').first()
                if subtype_match:
                    return subtype_match
            direct_match = qs.order_by('-updated_at').first()
            if direct_match:
                return direct_match

    # Strict fallback for cards without a usable trade product ID.
    # We require both name tokens and at least one secondary identifier
    # (set name, card number, or subtype hint). Ambiguous multi-price
    # results are rejected and handled as manual review.
    title = (item.title or '').strip()
    if not title:
        return None

    tokens = [
        token for token in _re.split(r'[^a-z0-9]+', title.lower())
        if token and len(token) >= 3
    ][:4]

    qs = TCGCardPrice.objects.filter(market_price__isnull=False)

    secondary_applied = False

    set_name = (item.tcg_set_name or '').strip()
    if set_name:
        qs = qs.filter(group_name__icontains=set_name)
        secondary_applied = True

    card_number = (item.card_number or '').strip()
    if card_number:
        qs = qs.filter(Q(name__icontains=card_number) | Q(clean_name__icontains=card_number))
        secondary_applied = True

    subtype_hint = (item.tcg_subtypes or '').split(',')[0].strip()
    if subtype_hint:
        qs = qs.filter(sub_type_name__icontains=subtype_hint)
        secondary_applied = True

    if not secondary_applied:
        return None

    for token in tokens:
        qs = qs.filter(clean_name__icontains=token)

    candidates = list(qs.order_by('-updated_at')[:25])
    if not candidates:
        return None

    distinct_prices = {str(row.market_price) for row in candidates if row.market_price is not None}
    if len(distinct_prices) != 1:
        return None

    return candidates[0]


def _build_card_pricing_workflow_data():
    cards_category = Category.objects.filter(slug='cards').first()
    if not cards_category:
        return {'manual_cards': [], 'changes': [], 'updates': []}

    items = Item.objects.filter(category=cards_category).order_by('title')
    manual_cards = []
    changes = []
    updates = []

    for item in items:
        price_entry = _resolve_trade_price_entry_for_item(item)
        if not price_entry or price_entry.market_price is None:
            query = ' '.join([part for part in [item.title, item.tcg_set_name or ''] if part]).strip()
            manual_cards.append({
                'item_id': item.id,
                'slug': item.slug,
                'title': item.title,
                'current_price': str(item.price),
                'set_name': item.tcg_set_name or '',
                'reason': 'Manual card (no import ID)' if not item.api_id else 'No market match found in trade database',
                'tcgplayer_search_url': f'https://www.tcgplayer.com/search/all/product?q={_quote_plus(query)}',
            })
            continue

        market_value = _Decimal(str(price_entry.market_price))
        proposed = _round_card_market_price(market_value)
        current = _Decimal(str(item.price))
        if proposed == current:
            continue

        changes.append({
            'item_id': item.id,
            'slug': item.slug,
            'title': item.title,
            'previous_value': str(current),
            'current_market_value': str(market_value),
            'proposed_new_value': str(proposed),
            'set_name': item.tcg_set_name or '',
            'tcgplayer_url': f'https://www.tcgplayer.com/product/{price_entry.product_id}' if price_entry.product_id else '',
        })
        updates.append((item, proposed))

    return {
        'manual_cards': manual_cards,
        'changes': changes,
        'updates': updates,
    }


class CardPricingWorkflowPreviewView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get(self, request):
        data = _build_card_pricing_workflow_data()
        return Response({
            'manual_cards': data['manual_cards'],
            'changes': data['changes'],
            'summary': {
                'manual_cards': len(data['manual_cards']),
                'changes': len(data['changes']),
            },
        })


class CardPricingWorkflowApplyView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def post(self, request):
        data = _build_card_pricing_workflow_data()
        updates = data['updates']
        if not updates:
            return Response({'updated': 0, 'message': 'No pricing updates were required.'})

        items_to_update = []
        for item, proposed in updates:
            item.price = proposed
            items_to_update.append(item)

        Item.objects.bulk_update(items_to_update, ['price'])
        return Response({
            'updated': len(items_to_update),
            'manual_cards': len(data['manual_cards']),
            'message': 'Pricing workflow applied successfully.',
        })


@api_view(['POST'])
@perm_classes_decorator([permissions.IsAuthenticated, IsStaffOrAdminEmail])
def reorder_images(request, slug):
    """Reorder images for an item. Expects { "order": [imageId1, imageId2, ...] }."""
    item = Item.objects.filter(slug=slug).first()
    if not item:
        return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)
    image_ids = request.data.get('order', [])
    if not isinstance(image_ids, list):
        return Response({'error': 'order must be a list of image IDs'}, status=status.HTTP_400_BAD_REQUEST)
    for position, img_id in enumerate(image_ids):
        ItemImage.objects.filter(id=img_id, item=item).update(position=position)
    return Response({'status': 'ok'})


class TCGCardSearchView(generics.ListAPIView):
    """Search TCG card prices. Public endpoint.
    GET /api/inventory/tcg-search/?q=charizard
    """
    serializer_class = TCGCardPriceSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        q = self.request.query_params.get('q', '').strip()
        if not q or len(q) < 2:
            return TCGCardPrice.objects.none()
        terms = q.split()
        qs = TCGCardPrice.objects.filter(market_price__isnull=False)
        for term in terms:
            qs = qs.filter(Q(clean_name__icontains=term) | Q(group_name__icontains=term))
        return qs[:20]


# ---------------------------------------------------------------------------
# Category / SubCategory ViewSets (Phase 7)
# ---------------------------------------------------------------------------

class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    lookup_field = 'slug'

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return Category.objects.prefetch_related('subcategories', 'tags').all()
        return Category.objects.prefetch_related('subcategories', 'tags').filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_core:
            return Response({'error': f'"{instance.name}" is a core category and cannot be deleted.'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_core:
            data = request.data
            if 'name' in data and data['name'] != instance.name:
                return Response({'error': 'Core category names cannot be changed.'}, status=status.HTTP_403_FORBIDDEN)
            if 'slug' in data and data['slug'] != instance.slug:
                return Response({'error': 'Core category slugs cannot be changed.'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)


class SubCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = SubCategorySerializer

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return SubCategory.objects.all()
        return SubCategory.objects.filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


# ---------------------------------------------------------------------------
# Promo Banner ViewSet (Phase 8)
# ---------------------------------------------------------------------------

class PromoBannerViewSet(viewsets.ModelViewSet):
    serializer_class = PromoBannerSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return PromoBanner.objects.all()
        return PromoBanner.objects.filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


# ---------------------------------------------------------------------------
# Homepage Section ViewSet (Phase 3 / 26)
# ---------------------------------------------------------------------------

class HomepageSectionViewSet(viewsets.ModelViewSet):
    serializer_class = HomepageSectionSerializer

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return HomepageSection.objects.prefetch_related('items', 'items__images', 'banners').all()
        visible_items_qs = Item.objects.filter(
            is_active=True
        ).filter(
            Q(stock__gt=0) | Q(show_when_out_of_stock=True)
        ).filter(
            Q(published_at__lte=tz.now()) | Q(preview_before_release=True, published_at__isnull=False)
        ).prefetch_related('images')
        return HomepageSection.objects.prefetch_related(
            Prefetch('items', queryset=visible_items_qs),
            'banners',
        ).filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


# ---------------------------------------------------------------------------
# TCG API Import (Phase 10/11 - pokemontcg.io)
# ---------------------------------------------------------------------------

class TCGImportView(APIView):
    """Search pokemontcg.io for card data.
    GET /api/inventory/tcg-import/?q=charizard
    """
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response({'error': 'q parameter is required'}, status=status.HTTP_400_BAD_REQUEST)
        from .services import fetch_tcg_card
        try:
            results = fetch_tcg_card(q)
            return Response({'results': results})
        except (RuntimeError, RequestsRequestException) as e:
            return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


class TCGSetsView(APIView):
    """Return list of all official TCG sets, cached 6 hours.
    GET /api/inventory/tcg-sets/
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        global _SETS_CACHE
        now = _time.time()
        if _SETS_CACHE['data'] is None or now - _SETS_CACHE['ts'] > 21600:
            try:
                resp = _requests.get(
                    'https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=300',
                    timeout=10
                )
                resp.raise_for_status()
                raw = resp.json().get('data', [])
                _SETS_CACHE = {
                    'data': [
                        {'id': s['id'], 'name': s['name'], 'series': s.get('series', ''), 'releaseDate': s.get('releaseDate', '')}
                        for s in raw
                    ],
                    'ts': now,
                }
            except Exception as e:
                return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({'results': _SETS_CACHE['data']})
