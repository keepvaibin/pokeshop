from django.urls import path

from . import views

app_name = 'trade_ins'

urlpatterns = [
    path('', views.CustomerTradeInListCreateView.as_view(), name='customer_list_create'),
    path('wallet/', views.WalletView.as_view(), name='wallet'),
    path('admin/', views.AdminTradeInListView.as_view(), name='admin_list'),
    path('admin/<int:pk>/', views.AdminTradeInDetailView.as_view(), name='admin_detail'),
    path('admin/<int:pk>/approve/', views.AdminTradeInApproveView.as_view(), name='admin_approve'),
    path('admin/<int:pk>/complete/', views.AdminTradeInCompleteView.as_view(), name='admin_complete'),
    path('admin/<int:pk>/reject/', views.AdminTradeInRejectView.as_view(), name='admin_reject'),
    path('<int:pk>/', views.CustomerTradeInDetailView.as_view(), name='customer_detail'),
]
