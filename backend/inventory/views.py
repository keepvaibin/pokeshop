from rest_framework import permissions, viewsets, parsers
from rest_framework.parsers import FormParser, MultiPartParser
from .models import Item, PickupSlot, WantedCard
from .serializers import ItemSerializer, PickupSlotSerializer, WantedCardSerializer

class IsStaffOrAdminEmail(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return user.is_staff or user.email.lower() == 'vashukla@ucsc.edu'

class ItemViewSet(viewsets.ModelViewSet):
    queryset = Item.objects.filter(is_active=True)
    serializer_class = ItemSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

class PickupSlotViewSet(viewsets.ModelViewSet):
    queryset = PickupSlot.objects.filter(is_claimed=False)
    serializer_class = PickupSlotSerializer

class WantedCardViewSet(viewsets.ModelViewSet):
    queryset = WantedCard.objects.filter(is_active=True)
    serializer_class = WantedCardSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]
