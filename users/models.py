from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.crypto import constant_time_compare
import hashlib
import secrets


def validate_ucsc_email(value):
    """Legacy validator - kept for migration compatibility. No longer enforced on the model field.
    UCSC domain check is enforced in GoogleAuthView instead."""
    if not value.endswith('@ucsc.edu'):
        raise ValidationError('Email must be from ucsc.edu domain.')


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('The Email field must be set')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_admin', True)
        return self.create_user(email, password, **extra_fields)

class User(AbstractUser):
    email = models.EmailField(unique=True)
    is_admin = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    first_name = models.CharField(max_length=100, blank=True, default='')
    last_name = models.CharField(max_length=100, blank=True, default='')
    nickname = models.CharField(max_length=50, blank=True, default='')
    discord_id = models.CharField(max_length=32, blank=True, null=True, unique=True, db_index=True)
    discord_handle = models.CharField(max_length=32, blank=True, default='')
    no_discord = models.BooleanField(default=False)

    def __str__(self):
        return f"Profile: {self.user.email}"


class BotAPIKey(models.Model):
    name = models.CharField(max_length=100, unique=True)
    key_prefix = models.CharField(max_length=12, editable=False, db_index=True)
    key_hash = models.CharField(max_length=64, editable=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name']

    @staticmethod
    def generate_key() -> str:
        return f"pkb_{secrets.token_urlsafe(32)}"

    def set_key(self, raw_key: str) -> None:
        self.key_prefix = raw_key[:12]
        self.key_hash = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()

    def check_key(self, raw_key: str) -> bool:
        expected_hash = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
        return constant_time_compare(self.key_hash, expected_hash)

    def mark_used(self) -> None:
        self.last_used_at = timezone.now()
        self.save(update_fields=['last_used_at'])

    def __str__(self):
        return self.name
