from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


class Item(models.Model):
    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=280, unique=True, blank=True)
    description = models.TextField(blank=True)
    short_description = models.CharField(max_length=300, blank=True, help_text="Brief summary shown on card listings")
    price = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    image_path = models.CharField(max_length=500, blank=True)
    stock = models.PositiveIntegerField(default=0)
    max_per_user = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    published_at = models.DateTimeField(null=True, blank=True, help_text="When the product page becomes visible. Null = hidden draft.")

    class Meta:
        ordering = ['-id']

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.title)
            slug = base
            n = 1
            while Item.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base}-{n}'
                n += 1
            self.slug = slug
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class ItemImage(models.Model):
    item = models.ForeignKey(Item, related_name='images', on_delete=models.CASCADE)
    image = models.ImageField(upload_to='inventory_images/')
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['position']

    def __str__(self):
        return f'{self.item.title} image #{self.position}'


class WantedCard(models.Model):
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=280, unique=True, blank=True)
    description = models.TextField(blank=True)
    estimated_value = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    tcg_card = models.ForeignKey('TCGCardPrice', on_delete=models.SET_NULL, null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)
            slug = base
            n = 1
            while WantedCard.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base}-{n}'
                n += 1
            self.slug = slug
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class WantedCardImage(models.Model):
    card = models.ForeignKey(WantedCard, related_name='images', on_delete=models.CASCADE)
    image = models.ImageField(upload_to='wanted_images/')
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['position']

    def __str__(self):
        return f'{self.card.name} image #{self.position}'


class PickupSlot(models.Model):
    date_time = models.DateTimeField()
    is_claimed = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.date_time} - {'Claimed' if self.is_claimed else 'Available'}"


class PokeshopSettings(models.Model):
    """Singleton config - only one row should ever exist."""
    trade_credit_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=85.00,
        help_text="Percentage of card value given as trade credit (e.g. 85 = 85%)",
    )
    store_announcement = models.TextField(blank=True, default='')
    max_trade_cards_per_order = models.PositiveIntegerField(default=5)
    discord_webhook_url = models.URLField(blank=True, default='', help_text="Discord webhook URL for order notifications")

    class Meta:
        verbose_name = "Pokeshop Settings"
        verbose_name_plural = "Pokeshop Settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Pokeshop Settings"


class PickupTimeslot(models.Model):
    start = models.DateTimeField()
    end = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    max_bookings = models.PositiveIntegerField(default=5)
    current_bookings = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['start']

    def clean(self):
        if self.end <= self.start:
            raise ValidationError("End time must be after start time.")
        if self.start < timezone.now():
            raise ValidationError("Cannot create a timeslot in the past.")
        overlapping = PickupTimeslot.objects.filter(
            start__lt=self.end, end__gt=self.start, is_active=True,
        ).exclude(pk=self.pk)
        if overlapping.exists():
            raise ValidationError("This timeslot overlaps with an existing one.")

    @property
    def is_available(self):
        return self.is_active and self.current_bookings < self.max_bookings and self.start > timezone.now()

    def __str__(self):
        return f"{self.start:%b %d %I:%M %p} - {self.end:%I:%M %p} ({self.current_bookings}/{self.max_bookings})"


class TCGCardPrice(models.Model):
    """Cached card prices from TCGCSV (TCGplayer data). Updated daily via sync_tcg_prices."""
    product_id = models.IntegerField(db_index=True)
    name = models.CharField(max_length=300)
    clean_name = models.CharField(max_length=300, db_index=True)
    group_id = models.IntegerField()
    group_name = models.CharField(max_length=200)
    image_url = models.URLField(max_length=500, blank=True, default='')
    sub_type_name = models.CharField(max_length=80, blank=True, default='Normal',
                                      help_text="e.g. Normal, Holofoil, Reverse Holofoil")
    rarity = models.CharField(max_length=100, blank=True, default='', help_text="e.g. Rare Holo, Common")
    market_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('product_id', 'sub_type_name')]
        ordering = ['name']

    def __str__(self):
        price = f"${self.market_price}" if self.market_price else "N/A"
        return f"{self.name} ({self.sub_type_name}) - {price}"


class RecurringTimeslot(models.Model):
    """Recurring weekly pickup window, e.g. 'Every Monday 2-4 PM'."""
    DAY_CHOICES = [
        (0, 'Monday'), (1, 'Tuesday'), (2, 'Wednesday'),
        (3, 'Thursday'), (4, 'Friday'), (5, 'Saturday'), (6, 'Sunday'),
    ]

    day_of_week = models.IntegerField(choices=DAY_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()
    max_bookings = models.PositiveIntegerField(default=5)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['day_of_week', 'start_time']

    def clean(self):
        if self.end_time <= self.start_time:
            raise ValidationError("End time must be after start time.")

    def __str__(self):
        day = dict(self.DAY_CHOICES).get(self.day_of_week, '?')
        return f"{day} {self.start_time:%I:%M %p} - {self.end_time:%I:%M %p}"


class AccessCode(models.Model):
    """One-time or multi-use access codes that allow non-UCSC users to register."""
    code = models.CharField(max_length=50, unique=True)
    usage_limit = models.PositiveIntegerField(default=1, help_text="0 = unlimited")
    times_used = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    note = models.CharField(max_length=255, blank=True, default='', help_text="Internal note, e.g. who this was issued for")
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_valid(self):
        if not self.is_active:
            return False
        if self.usage_limit > 0 and self.times_used >= self.usage_limit:
            return False
        if self.expires_at and timezone.now() >= self.expires_at:
            return False
        return True

    def __str__(self):
        return f"{self.code} ({self.times_used}/{self.usage_limit or '∞'})"


class InventoryDrop(models.Model):
    """A scheduled restock event that adds quantity to an item at a specific time."""
    item = models.ForeignKey(Item, related_name='scheduled_drops', on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField()
    drop_time = models.DateTimeField()
    is_processed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['drop_time']

    def __str__(self):
        status = 'done' if self.is_processed else 'pending'
        return f"{self.item.title} +{self.quantity} @ {self.drop_time:%b %d %I:%M %p} ({status})"
