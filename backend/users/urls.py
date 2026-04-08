from django.urls import path
from . import views

urlpatterns = [
    path('google/', views.GoogleAuthView.as_view(), name='google_auth'),
    path('user/', views.CurrentUserView.as_view(), name='current_user'),
]