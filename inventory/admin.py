from django.contrib import admin
from .models import (
    Item, ItemImage, WantedCard, WantedCardImage, PickupSlot,
    PokeshopSettings, PickupTimeslot, Category, SubCategory,
    PromoBanner, HomepageSection,
)

admin.site.register(Item)
admin.site.register(ItemImage)
admin.site.register(WantedCard)
admin.site.register(WantedCardImage)
admin.site.register(PickupSlot)
admin.site.register(PokeshopSettings)
admin.site.register(PickupTimeslot)
admin.site.register(Category)
admin.site.register(SubCategory)
admin.site.register(PromoBanner)
admin.site.register(HomepageSection)
