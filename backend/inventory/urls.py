from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'items', views.ItemViewSet, basename='item')
router.register(r'wanted', views.WantedCardViewSet, basename='wantedcard')
router.register(r'pickup-slots', views.PickupSlotViewSet)
router.register(r'settings', views.PokeshopSettingsView, basename='settings')
router.register(r'pickup-timeslots', views.PickupTimeslotViewSet, basename='pickup-timeslot')
router.register(r'recurring-timeslots', views.RecurringTimeslotViewSet, basename='recurring-timeslot')
router.register(r'access-codes', views.AccessCodeViewSet, basename='access-code')
router.register(r'inventory-drops', views.InventoryDropViewSet, basename='inventory-drop')

urlpatterns = [
    path('items/by-id/<int:pk>/', views.ItemByIdView.as_view(), name='item-by-id'),
    path('items/<slug:slug>/reorder-images/', views.reorder_images, name='reorder-images'),
    path('tcg-search/', views.TCGCardSearchView.as_view(), name='tcg-card-search'),
    path('', include(router.urls)),
]