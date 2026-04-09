from django.contrib import admin
from .models import Item, ItemImage, WantedCard, WantedCardImage, PickupSlot, PokeshopSettings, PickupTimeslot

admin.site.register(Item)
admin.site.register(ItemImage)
admin.site.register(WantedCard)
admin.site.register(WantedCardImage)
admin.site.register(PickupSlot)
admin.site.register(PokeshopSettings)
admin.site.register(PickupTimeslot)
