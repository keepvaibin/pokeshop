from django.db import models

class Item(models.Model):
    title = models.CharField(max_length=255)
    description = models.TextField()
    image_path = models.CharField(max_length=500, blank=True)  # Path to uploaded image
    stock = models.PositiveIntegerField(default=0)
    max_per_user = models.PositiveIntegerField(default=1)  # Anti-hoarding rule
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.title

class PickupSlot(models.Model):
    date_time = models.DateTimeField()
    is_claimed = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.date_time} - {'Claimed' if self.is_claimed else 'Available'}"
