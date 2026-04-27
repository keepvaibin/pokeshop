from django.contrib import admin

from .models import TradeInRequest, TradeInItem, CreditLedger


class TradeInItemInline(admin.TabularInline):
    model = TradeInItem
    extra = 0


@admin.register(TradeInRequest)
class TradeInRequestAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'user', 'status', 'submission_method',
        'recurring_timeslot', 'pickup_date',
        'estimated_total_value', 'final_payout_value', 'created_at',
    )
    list_filter = ('status', 'submission_method', 'pickup_date')
    search_fields = ('user__email', 'admin_notes', 'customer_notes')
    readonly_fields = ('created_at', 'updated_at', 'reviewed_at', 'completed_at')
    inlines = [TradeInItemInline]


@admin.register(CreditLedger)
class CreditLedgerAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'amount', 'transaction_type', 'reference_id', 'created_at')
    list_filter = ('transaction_type',)
    search_fields = ('user__email', 'reference_id', 'note')
    readonly_fields = ('created_at',)
