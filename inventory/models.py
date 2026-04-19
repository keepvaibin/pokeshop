from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


# ---------------------------------------------------------------------------
# TCG Enumerations
# ---------------------------------------------------------------------------

class TCGType(models.TextChoices):
    FIRE        = 'Fire',       'Fire'
    WATER       = 'Water',      'Water'
    GRASS       = 'Grass',      'Grass'
    PSYCHIC     = 'Psychic',    'Psychic'
    FIGHTING    = 'Fighting',   'Fighting'
    DARKNESS    = 'Darkness',   'Darkness'
    METAL       = 'Metal',      'Metal'
    LIGHTNING   = 'Lightning',  'Lightning'
    FAIRY       = 'Fairy',      'Fairy'
    DRAGON      = 'Dragon',     'Dragon'
    COLORLESS   = 'Colorless',  'Colorless'


class TCGStage(models.TextChoices):
    BASIC   = 'Basic',    'Basic'
    STAGE_1 = 'Stage 1',  'Stage 1'
    STAGE_2 = 'Stage 2',  'Stage 2'
    MEGA    = 'Mega',     'Mega'
    BREAK   = 'BREAK',    'BREAK'
    VMAX    = 'VMAX',     'VMAX'
    VSTAR   = 'VSTAR',    'VSTAR'
    TERA    = 'Tera',     'Tera'


class TCGRarity(models.TextChoices):
    COMMON             = 'Common',                   'Common'
    UNCOMMON           = 'Uncommon',                 'Uncommon'
    RARE               = 'Rare',                     'Rare'
    HOLO_RARE          = 'Holo Rare',                'Holo Rare'
    ULTRA_RARE         = 'Ultra Rare',               'Ultra Rare (ex/V/GX/EX)'
    ILLUS_RARE         = 'Illustration Rare',        'Illustration Rare (IR)'
    SPECIAL_ILLUS_RARE = 'Special Illustration Rare','Special Illustration Rare (SIR)'
    GOLD_SECRET_RARE   = 'Gold Secret Rare',         'Gold Secret Rare'


# ---------------------------------------------------------------------------
# Category / SubCategory
# ---------------------------------------------------------------------------

class Category(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    image_url = models.URLField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    is_core = models.BooleanField(default=False, help_text="Sacred-Three category — cannot be deleted or renamed")

    class Meta:
        verbose_name_plural = "Categories"
        ordering = ['name']

    def __str__(self):
        return self.name


class SubCategory(models.Model):
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='subcategories')
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "Sub Categories"
        ordering = ['name']

    def __str__(self):
        return self.name


class ItemTag(models.Model):
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='tags')
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = 'Item Tag'
        verbose_name_plural = 'Item Tags'
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['category', 'slug'], name='uniq_itemtag_category_slug'),
        ]

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or 'tag'
            slug = base
            suffix = 1
            while ItemTag.objects.filter(category=self.category, slug=slug).exclude(pk=self.pk).exists():
                suffix += 1
                slug = f'{base}-{suffix}'
            self.slug = slug
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.category.name}: {self.name}'


# ---------------------------------------------------------------------------
# Promo Banner (Hero / Category Quick-Links CMS)
# ---------------------------------------------------------------------------

class PromoBanner(models.Model):
    SIZE_CHOICES = [
        ('FULL', 'Full'),
        ('HALF', 'Half'),
        ('QUARTER', 'Quarter'),
    ]

    title = models.CharField(max_length=200)
    subtitle = models.CharField(max_length=300, blank=True, null=True)
    image_url = models.URLField(blank=True, default='')
    image = models.ImageField(upload_to='promo_banners/', blank=True, null=True)
    link_url = models.CharField(max_length=500, help_text="Absolute or relative URL")
    size = models.CharField(max_length=10, choices=SIZE_CHOICES, default='QUARTER')
    position_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['position_order']

    def __str__(self):
        return self.title


# ---------------------------------------------------------------------------
# Curated Homepage Sections
# ---------------------------------------------------------------------------

class HomepageSection(models.Model):
    SECTION_CHOICES = [
        ('CAROUSEL', 'Carousel'),
        ('GRID', 'Grid'),
        ('HERO', 'Hero'),
    ]

    title = models.CharField(max_length=150)
    section_type = models.CharField(max_length=10, choices=SECTION_CHOICES)
    position_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    items = models.ManyToManyField('Item', related_name='homepage_sections', blank=True)
    banners = models.ManyToManyField('PromoBanner', related_name='homepage_sections', blank=True)

    class Meta:
        ordering = ['position_order']

    def __str__(self):
        return f"{self.title} ({self.section_type})"


# ---------------------------------------------------------------------------
# Item (extended with TCG + Category fields)
# ---------------------------------------------------------------------------

class Item(models.Model):
    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=280, unique=True, blank=True)
    description = models.TextField(blank=True)
    short_description = models.CharField(max_length=300, blank=True, help_text="Brief summary shown on card listings")
    price = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    image_path = models.CharField(max_length=500, blank=True)
    stock = models.PositiveIntegerField(default=0)
    max_per_user = models.PositiveIntegerField(default=0)
    max_per_week = models.PositiveIntegerField(null=True, blank=True, help_text="Max qty per user per rolling 7-day window. Null = no weekly limit.")
    max_total_per_user = models.PositiveIntegerField(null=True, blank=True, help_text="Max qty per user all-time. Null = no lifetime limit.")
    is_active = models.BooleanField(default=True)
    published_at = models.DateTimeField(null=True, blank=True, help_text="When the product page becomes visible. Null = hidden draft.")
    preview_before_release = models.BooleanField(default=False, help_text="If True, page is visible now but shows 'Coming Soon' until published_at.")

    # TCG-specific fields (Phase 4)
    tcg_set_name = models.CharField(max_length=100, blank=True, null=True)
    rarity = models.CharField(max_length=50, blank=True, null=True)
    is_holofoil = models.BooleanField(default=False)
    card_number = models.CharField(max_length=20, blank=True, null=True)
    api_id = models.CharField(max_length=50, blank=True, null=True, db_index=True, help_text="pokemontcg.io card ID")

    # Category fields (Phase 4)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True, related_name='items')
    subcategory = models.ForeignKey(SubCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='items')
    tags = models.ManyToManyField(ItemTag, blank=True, related_name='items')

    # Extended TCG facet fields
    tcg_type       = models.CharField(max_length=20, choices=TCGType.choices,   blank=True, null=True, db_index=True)
    tcg_stage      = models.CharField(max_length=20, choices=TCGStage.choices,  blank=True, null=True, db_index=True)
    rarity_type    = models.CharField(max_length=30, choices=TCGRarity.choices, blank=True, null=True, db_index=True)

    # Deep TCG metadata
    tcg_supertype        = models.CharField(max_length=20, blank=True, null=True, help_text="Pokémon/Trainer/Energy")
    tcg_subtypes         = models.CharField(max_length=200, blank=True, null=True, help_text="Comma-separated subtypes e.g. Basic, EX")
    tcg_hp               = models.PositiveIntegerField(blank=True, null=True)
    tcg_artist           = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    tcg_set_release_date = models.DateField(blank=True, null=True)

    # Timestamps
    created_at = models.DateTimeField(default=timezone.now, editable=False, db_index=True)

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
    announcement_expires_at = models.DateTimeField(null=True, blank=True, help_text="Auto-clear announcement after this date/time")
    show_footer_newsletter = models.BooleanField(default=True, help_text="Controls the footer signup block on the storefront")
    max_trade_cards_per_order = models.PositiveIntegerField(default=5)
    discord_webhook_url = models.URLField(blank=True, default='', help_text="Discord webhook URL for order notifications")
    last_discord_eod_summary_on = models.DateField(null=True, blank=True)
    ucsc_discord_invite = models.URLField(blank=True, null=True)
    public_discord_invite = models.URLField(blank=True, null=True)
    is_ooo = models.BooleanField(default=False, help_text="Out of Office mode — hides ASAP, timeslots only show after ooo_until date")
    ooo_until = models.DateField(null=True, blank=True, help_text="Date the admin returns (inclusive). Required when is_ooo=True.")
    orders_disabled = models.BooleanField(default=False, help_text="Completely disable all orders (ASAP + scheduled)")
    pay_venmo_enabled = models.BooleanField(default=True, help_text="Show Venmo as a payment option at checkout")
    pay_zelle_enabled = models.BooleanField(default=True, help_text="Show Zelle as a payment option at checkout")
    pay_paypal_enabled = models.BooleanField(default=True, help_text="Show PayPal as a payment option at checkout")
    pay_cash_enabled = models.BooleanField(default=True, help_text="Show Cash as a payment option at checkout")
    pay_trade_enabled = models.BooleanField(default=True, help_text="Show Trade-In as a payment option at checkout")

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

    def active_booking_count(self) -> int:
        if not self.pk:
            return 0

        from orders.models import Order

        return Order.objects.filter(
            pickup_timeslot=self,
            status__in=Order.ACTIVE_SLOT_STATUSES,
        ).count()

    def refresh_current_bookings(self, *, save: bool = True) -> int:
        bookings = self.active_booking_count()
        self.current_bookings = bookings
        if save and self.pk:
            type(self).objects.filter(pk=self.pk).update(current_bookings=bookings)
        return bookings

    def booking_count_value(self) -> int:
        annotated_count = getattr(self, 'active_bookings_count', None)
        if annotated_count is not None:
            return annotated_count
        return self.current_bookings

    @property
    def remaining_capacity(self) -> int:
        return max(0, self.max_bookings - self.booking_count_value())

    @property
    def is_available(self):
        return self.is_active and self.remaining_capacity > 0 and self.start > timezone.now()

    def __str__(self):
        return f"{self.start:%b %d %I:%M %p} - {self.end:%I:%M %p} ({self.booking_count_value()}/{self.max_bookings})"


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
    location = models.CharField(max_length=160, blank=True, default='')
    max_bookings = models.PositiveIntegerField(default=5)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['day_of_week', 'start_time']

    def clean(self):
        if self.end_time <= self.start_time:
            raise ValidationError("End time must be after start time.")

    def next_pickup_date(self, reference_date=None):
        reference_date = reference_date or timezone.localdate()
        days_until_slot = self.day_of_week - reference_date.weekday()
        if days_until_slot < 0:
            days_until_slot += 7
        return reference_date + timedelta(days=days_until_slot)

    def active_booking_count(self, pickup_date=None) -> int:
        if not self.pk:
            return 0

        from orders.models import Order

        return Order.objects.filter(
            recurring_timeslot=self,
            pickup_date=pickup_date or self.next_pickup_date(),
            status__in=Order.ACTIVE_SLOT_STATUSES,
        ).count()

    def remaining_capacity(self, pickup_date=None) -> int:
        return max(0, self.max_bookings - self.active_booking_count(pickup_date=pickup_date))

    def __str__(self):
        day = dict(self.DAY_CHOICES).get(self.day_of_week, '?')
        time_range = f"{day} {self.start_time:%I:%M %p} - {self.end_time:%I:%M %p}"
        return f"{time_range} • {self.location}" if self.location else time_range


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
