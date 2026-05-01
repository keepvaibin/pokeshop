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
router.register(r'categories', views.CategoryViewSet, basename='category')
router.register(r'subcategories', views.SubCategoryViewSet, basename='subcategory')
router.register(r'promo-banners', views.PromoBannerViewSet, basename='promo-banner')
router.register(r'homepage-sections', views.HomepageSectionViewSet, basename='homepage-section')

urlpatterns = [
    path('items/by-id/<int:pk>/', views.ItemByIdView.as_view(), name='item-by-id'),
    path('items/facets/', views.ItemFacetsView.as_view(), name='item-facets'),
    path('items/<slug:slug>/reorder-images/', views.reorder_images, name='reorder-images'),
    path('cards/pricing-workflow/', views.CardPricingWorkflowPreviewView.as_view(), name='cards-pricing-workflow-preview'),
    path('cards/pricing-workflow/apply/', views.CardPricingWorkflowApplyView.as_view(), name='cards-pricing-workflow-apply'),
    path('admin/jobs/<uuid:job_id>/', views.AdminBackgroundJobStatusView.as_view(), name='admin-background-job-status'),
    path('admin/cards/', views.AdminCardsView.as_view(), name='admin-cards'),
    path('admin/cards/sync-properties/', views.AdminCardPropertySyncView.as_view(), name='admin-cards-sync-properties'),
    path('tcg-search/', views.TCGCardSearchView.as_view(), name='tcg-card-search'),
    path('tcg-inventory-search/', views.AdminTCGInventorySearchView.as_view(), name='tcg-inventory-search'),
    path('tcg-import/', views.TCGImportView.as_view(), name='tcg-import'),
    path('tcg-sets/', views.TCGSetsView.as_view(), name='tcg-sets'),
    path('', include(router.urls)),
]