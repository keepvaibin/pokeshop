from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'items', views.ItemViewSet)
router.register(r'pickup-slots', views.PickupSlotViewSet)
router.register(r'wanted-cards', views.WantedCardViewSet)

urlpatterns = [
    path('', include(router.urls)),
]