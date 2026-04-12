from django.urls import path
from . import views

urlpatterns = [
    path('checkout/', views.CheckoutView.as_view(), name='checkout'),
    path('support-tickets/', views.TicketCreateAPIView.as_view(), name='support-ticket-create'),
    path('discord-heartbeat/', views.DiscordHeartbeatView.as_view(), name='discord-heartbeat'),
    path('dispatch/', views.DispatchView.as_view(), name='dispatch'),
    path('my-orders/', views.UserOrdersView.as_view(), name='my-orders'),
    path('admin-history/', views.AdminOrderHistoryView.as_view(), name='admin-order-history'),
    path('purchase-limits/', views.PurchaseLimitsView.as_view(), name='purchase-limits'),
    path('cancel/', views.CancelOrderView.as_view(), name='cancel-order'),
    path('respond-counteroffer/', views.RespondCounterOfferView.as_view(), name='respond-counteroffer'),
    path('reschedule/', views.RescheduleOrderView.as_view(), name='reschedule-order'),
    path('receipt/<uuid:order_id>/', views.OrderDetailView.as_view(), name='order-detail'),
    path('coupons/', views.CouponListCreateView.as_view(), name='coupon-list-create'),
    path('coupons/<int:pk>/', views.CouponDetailView.as_view(), name='coupon-detail'),
    path('validate-coupon/', views.ValidateCouponView.as_view(), name='validate-coupon'),
    path('active-timeslots/', views.ActiveTimeslotsView.as_view(), name='active-timeslots'),
]