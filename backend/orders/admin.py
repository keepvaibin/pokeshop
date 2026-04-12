from django.contrib import admin

from .models import Coupon, Order, SupportTicket, TradeCardItem, TradeOffer


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
	list_display = ('order_id', 'user', 'item', 'status', 'created_at')
	list_filter = ('status', 'payment_method', 'delivery_method')
	search_fields = ('order_id', 'user__email', 'discord_handle', 'item__title')


@admin.register(TradeOffer)
class TradeOfferAdmin(admin.ModelAdmin):
	list_display = ('order', 'total_credit', 'credit_percentage', 'trade_mode', 'created_at')
	list_filter = ('trade_mode',)
	search_fields = ('order__order_id', 'order__user__email')


@admin.register(TradeCardItem)
class TradeCardItemAdmin(admin.ModelAdmin):
	list_display = ('card_name', 'trade_offer', 'estimated_value', 'approved', 'is_accepted')
	list_filter = ('approved', 'is_accepted', 'condition', 'rarity')
	search_fields = ('card_name', 'trade_offer__order__order_id', 'trade_offer__order__user__email')


@admin.register(Coupon)
class CouponAdmin(admin.ModelAdmin):
	list_display = ('code', 'is_active', 'times_used', 'usage_limit', 'expires_at')
	list_filter = ('is_active',)
	search_fields = ('code',)


@admin.register(SupportTicket)
class SupportTicketAdmin(admin.ModelAdmin):
	list_display = ('ticket_id', 'subject', 'discord_user_id', 'status', 'created_at')
	list_filter = ('status',)
	search_fields = ('ticket_id', 'subject', 'discord_user_id', 'discord_channel_id', 'user__email')
	readonly_fields = ('ticket_id', 'created_at', 'updated_at')
