from django.db import models
from django.utils.text import slugify

class Item(models.Model):
    title = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, blank=True)
    description = models.TextField()
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    stock = models.PositiveIntegerField(default=0)
    max_per_user = models.PositiveIntegerField(default=1)  # Anti-hoarding rule
    is_active = models.BooleanField(default=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.title)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title

    def __str__(self):
        return self.title

class PickupSlot(models.Model):
    date_time = models.DateTimeField()
    is_claimed = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.date_time} - {'Claimed' if self.is_claimed else 'Available'}"

class WantedCard(models.Model):
    title = models.CharField(max_length=255)
    description = models.TextField()
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.title

class ItemImage(models.Model):
    item = models.ForeignKey(Item, related_name='images', on_delete=models.CASCADE)
    image_path = models.CharField(max_length=500)

    def __str__(self):
        return f"Image for {self.item.title}"

class WantedCardImage(models.Model):
    wanted_card = models.ForeignKey(WantedCard, related_name='images', on_delete=models.CASCADE)
    image_path = models.CharField(max_length=500)

    def __str__(self):
        return f"Image for {self.wanted_card.title}"
