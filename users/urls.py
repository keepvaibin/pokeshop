from django.urls import path
from . import views

urlpatterns = [
    path('google/', views.GoogleAuthView.as_view(), name='google_auth'),
    path('discord/login/', views.DiscordOAuthInitiateView.as_view(), name='discord_oauth_login'),
    path('discord/initiate/', views.DiscordOAuthInitiateView.as_view(), name='discord_oauth_initiate'),
    path('discord/callback/', views.DiscordOAuthCallbackView.as_view(), name='discord_oauth_callback'),
    path('user/', views.CurrentUserView.as_view(), name='current_user'),
    path('profile/', views.UpdateProfileView.as_view(), name='update_profile'),
    path('validate-access-code/', views.ValidateAccessCodeView.as_view(), name='validate_access_code'),
    path('register/', views.RegisterWithAccessCodeView.as_view(), name='register'),
    path('login/', views.EmailLoginView.as_view(), name='email_login'),
]