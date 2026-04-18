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
    path('pokemon-icons/', views.PokemonIconListView.as_view(), name='pokemon_icons'),
    path('search-users/', views.SearchUsersView.as_view(), name='search_users'),
    path('users-with-strikes/', views.UsersWithStrikesView.as_view(), name='users_with_strikes'),
    path('strikes/', views.StrikeListCreateDeleteView.as_view(), name='strikes'),
    path('strikes/<int:pk>/', views.StrikeDeleteView.as_view(), name='strike_delete'),
    path('my-strikes/', views.MyStrikesView.as_view(), name='my_strikes'),
]