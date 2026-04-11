from rest_framework import generics, permissions, viewsets, status
from rest_framework.decorators import api_view, permission_classes as perm_classes_decorator
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from django.db.models import Q
from django.utils import timezone as tz
from .models import Item, ItemImage, WantedCard, PickupSlot, PokeshopSettings, PickupTimeslot, RecurringTimeslot, TCGCardPrice, AccessCode
from .serializers import (
    ItemSerializer, WantedCardSerializer, PickupSlotSerializer,
    PokeshopSettingsSerializer, PickupTimeslotSerializer, RecurringTimeslotSerializer,
    TCGCardPriceSerializer, AccessCodeSerializer,
)


class IsStaffOrAdminEmail(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return user.is_staff or user.email.lower() == 'vashukla@ucsc.edu'


class ItemViewSet(viewsets.ModelViewSet):
    serializer_class = ItemSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    lookup_field = 'slug'

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return Item.objects.all()
        return Item.objects.filter(is_active=True).filter(
            Q(go_live_date__isnull=True) | Q(go_live_date__lte=tz.now())
        )

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


class ItemByIdView(generics.RetrieveAPIView):
    """Retrieve a single item by numeric PK (used by checkout / cart)."""
    queryset = Item.objects.filter(is_active=True)
    serializer_class = ItemSerializer


class WantedCardViewSet(viewsets.ModelViewSet):
    serializer_class = WantedCardSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    lookup_field = 'slug'

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return WantedCard.objects.all()
        return WantedCard.objects.filter(is_active=True)

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
        from django.db import transaction as db_transaction
        from django.core.exceptions import ValidationError as DjangoValidationError
        from rest_framework.exceptions import ValidationError as DRFValidationError
        try:
            with db_transaction.atomic():
                instance = serializer.save()
                instance.full_clean()
        except DjangoValidationError as e:
            raise DRFValidationError(e.message_dict if hasattr(e, 'message_dict') else e.messages)


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


class AccessCodeViewSet(viewsets.ModelViewSet):
    """Admin-only CRUD for access codes."""
    serializer_class = AccessCodeSerializer
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get_queryset(self):
        return AccessCode.objects.all().order_by('-created_at')


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
