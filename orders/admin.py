from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.utils import timezone

from .models import Coupon, DiscordPickupLifecycleRun, DiscordRoleEvent, Order, OrderItem, SupportTicket, TradeCardItem, TradeOffer
from .services import send_discord_dm


class SupportTicketAdminForm(forms.ModelForm):
	reply_message = forms.CharField(
		label='Reply',
		required=False,
		widget=forms.Textarea(attrs={'rows': 6}),
		help_text='Send a Discord DM reply to the linked user and close the ticket.',
	)

	class Meta:
		model = SupportTicket
		fields = '__all__'


class OrderItemInline(admin.TabularInline):
	model = OrderItem
	extra = 0
	readonly_fields = ('item', 'quantity', 'price_at_purchase')


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
	list_display = ('order_id', 'user', 'status', 'created_at')
	list_filter = ('status', 'payment_method', 'delivery_method')
	search_fields = ('order_id', 'user__email', 'discord_handle')
	inlines = [OrderItemInline]


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
	list_display = ('code', 'is_active', 'discount_amount', 'discount_percent', 'min_order_total', 'requires_cash_only', 'times_used', 'usage_limit', 'expires_at')
	list_filter = ('is_active', 'requires_cash_only')
	search_fields = ('code',)
	filter_horizontal = ('specific_products', 'specific_categories', 'specific_subcategories', 'specific_tags')


@admin.register(DiscordRoleEvent)
class DiscordRoleEventAdmin(admin.ModelAdmin):
	list_display = ('event_type', 'discord_id', 'pickup_date', 'status', 'attempt_count', 'created_at', 'processed_at')
	list_filter = ('event_type', 'status', 'pickup_date')
	search_fields = ('discord_id', 'order__order_id', 'last_error')
	readonly_fields = ('created_at', 'updated_at', 'processed_at')


@admin.register(DiscordPickupLifecycleRun)
class DiscordPickupLifecycleRunAdmin(admin.ModelAdmin):
	list_display = ('run_date', 'status', 'started_at', 'finished_at', 'updated_at')
	list_filter = ('status', 'run_date')
	search_fields = ('last_error',)
	readonly_fields = ('started_at', 'finished_at', 'updated_at')


@admin.register(SupportTicket)
class SupportTicketAdmin(admin.ModelAdmin):
	form = SupportTicketAdminForm
	list_display = ('user', 'subject', 'status', 'created_at')
	list_filter = ('status',)
	search_fields = ('ticket_id', 'subject', 'discord_user_id', 'discord_channel_id', 'user__email')
	readonly_fields = ('ticket_id', 'discord_user_id', 'discord_channel_id', 'initial_message', 'created_at', 'updated_at', 'closed_at')
	fieldsets = (
		('Ticket', {'fields': ('ticket_id', 'user', 'order', 'subject', 'initial_message', 'status')}),
		('Discord', {'fields': ('discord_user_id', 'discord_channel_id')}),
		('Reply', {'fields': ('reply_message',)}),
		('Metadata', {'fields': ('metadata', 'created_at', 'updated_at', 'closed_at')}),
	)

	def _order_url(self, ticket):
		if not ticket.order_id:
			return None
		return f"{settings.FRONTEND_URL.rstrip('/')}/orders/{ticket.order.order_id}"

	def save_model(self, request, obj, form, change):
		reply_message = (form.cleaned_data.get('reply_message') or '').strip()
		if reply_message:
			sent = send_discord_dm(
				obj.user,
				'Support Ticket Reply',
				reply_message,
				'#0c55a5',
				url=self._order_url(obj),
			)
			if sent:
				obj.status = 'closed'
				obj.closed_at = timezone.now()
				self.message_user(request, 'Reply sent by Discord DM and ticket closed.', level=messages.SUCCESS)
			else:
				self.message_user(request, 'Could not send the Discord DM reply. The ticket was left open.', level=messages.ERROR)
		super().save_model(request, obj, form, change)
