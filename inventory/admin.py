from django.contrib import admin
from django.contrib import messages
from .models import (
    Item, ItemImage, WantedCard, WantedCardImage, PickupSlot,
    PokeshopSettings, PickupTimeslot, Category, SubCategory, ItemTag,
    PromoBanner, HomepageSection,
)

@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ('title', 'price', 'stock', 'is_active', 'max_per_user', 'max_per_week', 'max_total_per_user')
    search_fields = ('title',)
    list_filter = ('is_active',)
admin.site.register(ItemImage)
admin.site.register(WantedCard)
admin.site.register(WantedCardImage)
admin.site.register(PickupSlot)
admin.site.register(PokeshopSettings)
admin.site.register(PickupTimeslot)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'is_core', 'is_active')
    list_filter = ('is_core', 'is_active')
    search_fields = ('name', 'slug')

    def get_readonly_fields(self, request, obj=None):
        readonly_fields = list(super().get_readonly_fields(request, obj))
        if obj and obj.is_core:
            readonly_fields.extend(['name', 'slug'])
        return readonly_fields

    def has_delete_permission(self, request, obj=None):
        if obj and obj.is_core:
            return False
        return super().has_delete_permission(request, obj)

    def delete_model(self, request, obj):
        if obj.is_core:
            self.message_user(request, 'Core categories cannot be deleted.', level=messages.ERROR)
            return
        super().delete_model(request, obj)

    def delete_queryset(self, request, queryset):
        core_count = queryset.filter(is_core=True).count()
        if core_count:
            self.message_user(request, f'Skipped {core_count} core categor{("y" if core_count == 1 else "ies")} during delete.', level=messages.WARNING)
        super().delete_queryset(request, queryset.filter(is_core=False))


admin.site.register(SubCategory)
admin.site.register(ItemTag)
admin.site.register(PromoBanner)
admin.site.register(HomepageSection)
