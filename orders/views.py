from decimal import Decimal

import json
import logging

from rest_framework import status, generics
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.throttling import UserRateThrottle
from django.db import transaction, models, IntegrityError
from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import timedelta, time as dt_time
from users.models import UserProfile
from users.permissions import HasBotAPIKey
from pokeshop.input_safety import sanitize_plain_text

logger = logging.getLogger(__name__)


def _decimal_percentage(value):
    return Decimal(str(value)) / Decimal('100')


class IsShopAdmin(BasePermission):
    """Allow access only to users with the is_admin flag set."""
    message = 'Admin access required.'

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and getattr(request.user, 'is_admin', False)
        )
from .serializers import CheckoutSerializer, OrderSerializer, CouponSerializer, SupportTicketCreateSerializer, SupportTicketSerializer, TradeCardInputSerializer, CartItemSerializer, PAYMENT_MINIMUMS
from inventory.models import Item, PickupSlot, PokeshopSettings, PickupTimeslot, RecurringTimeslot, TCGCardPrice
from inventory.trade_utils import calc_trade_credit, normalize_condition
from .models import Order, OrderItem, TradeOffer, TradeCardItem, Coupon, SupportTicket, CartItem
from .services import collect_discord_heartbeat_actions


def append_timeline(order, event, detail=''):
    """Append a timestamped event to the order's resolution_summary."""
    if not isinstance(order.resolution_summary, list):
        order.resolution_summary = []
    order.resolution_summary.append({
        'timestamp': timezone.now().isoformat(),
        'event': event,
        'detail': detail,
    })


def _restore_order_stock(order):
    """Restore stock for all items in an order (within an atomic block)."""
    for oi in order.order_items.select_related('item'):
        item = Item.objects.select_for_update().get(id=oi.item_id)
        item.stock += oi.quantity
        item.save()


def _order_sale_price(order):
    """Calculate total sale price from order items."""
    return sum(oi.price_at_purchase * oi.quantity for oi in order.order_items.all())


def get_noon_reset_cutoff():
    """Return the most recent noon (12:00 PM local) as a timezone-aware datetime.

    If current local time is before noon, the cutoff is yesterday at noon.
    Otherwise, the cutoff is today at noon.
    """
    now_local = timezone.localtime()
    noon_today = now_local.replace(hour=12, minute=0, second=0, microsecond=0)
    if now_local < noon_today:
        return noon_today - timedelta(days=1)
    return noon_today


class CheckoutThrottle(UserRateThrottle):
    scope = 'checkout'


class CheckoutView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [CheckoutThrottle]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        data = {k: v for k, v in request.data.items()}

        for bool_field in ('buy_if_trade_denied',):
            if isinstance(data.get(bool_field), str):
                data[bool_field] = data[bool_field].lower() in ('true', '1', 'yes')

        # Parse items from JSON string (FormData) or list (JSON body)
        items_raw = data.pop('items', None)
        if isinstance(items_raw, str):
            try:
                items_raw = json.loads(items_raw)
            except (json.JSONDecodeError, TypeError):
                return Response({'error': 'Invalid items data.'}, status=status.HTTP_400_BAD_REQUEST)
        if items_raw:
            data['items'] = items_raw

        # --- Extract trade card data BEFORE serializer validation ---
        trade_data_raw = data.pop('trade_offer_data', None) or data.pop('trade_cards', None) or '[]'
        trade_mode = data.pop('trade_mode', 'all_or_nothing')
        if isinstance(trade_mode, str) and trade_mode not in ('all_or_nothing', 'allow_partial'):
            trade_mode = 'all_or_nothing'

        if isinstance(trade_data_raw, str):
            try:
                trade_cards = json.loads(trade_data_raw)
            except (json.JSONDecodeError, TypeError):
                return Response({'error': 'Invalid trade card data - could not parse JSON.'}, status=status.HTTP_400_BAD_REQUEST)
        elif isinstance(trade_data_raw, list):
            trade_cards = trade_data_raw
        else:
            trade_cards = []

        if trade_cards:
            if not isinstance(trade_cards, list):
                return Response({'error': 'trade_cards must be a list.'}, status=status.HTTP_400_BAD_REQUEST)
            trade_cards_serializer = TradeCardInputSerializer(data=trade_cards, many=True)
            if not trade_cards_serializer.is_valid():
                return Response({'trade_cards': trade_cards_serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
            trade_cards = trade_cards_serializer.validated_data

        serializer = CheckoutSerializer(data=data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        cart_items = serializer.validated_data['items']
        payment_method = serializer.validated_data['payment_method']
        delivery_method = serializer.validated_data['delivery_method']
        pickup_slot_id = serializer.validated_data.get('pickup_slot_id')
        pickup_timeslot_id = serializer.validated_data.get('pickup_timeslot_id')
        recurring_timeslot_id = serializer.validated_data.get('recurring_timeslot_id')
        pickup_date = serializer.validated_data.get('pickup_date')
        discord_handle = serializer.validated_data.get('discord_handle', '').strip()
        if not discord_handle:
            profile, _ = UserProfile.objects.get_or_create(user=request.user)
            discord_handle = profile.discord_handle or ''
        buy_if_trade_denied = serializer.validated_data.get('buy_if_trade_denied', False)
        preferred_pickup_time = serializer.validated_data.get('preferred_pickup_time', '')

        # Validate all items exist
        item_ids = [ci['item_id'] for ci in cart_items]
        existing = set(Item.objects.filter(id__in=item_ids, is_active=True).values_list('id', flat=True))
        missing = set(item_ids) - existing
        if missing:
            return Response({'error': f'Item(s) not found: {list(missing)}'}, status=status.HTTP_404_NOT_FOUND)

        # Load settings
        settings = PokeshopSettings.load()
        credit_pct = _decimal_percentage(settings.trade_credit_percentage)

        # Calculate total sale price across all items
        item_objs = {i.id: i for i in Item.objects.filter(id__in=item_ids)}
        sale_price = Decimal('0')
        for ci in cart_items:
            item_obj = item_objs[ci['item_id']]
            sale_price += item_obj.price * ci['quantity']

        # --- Coupon validation & discount calculation ---
        coupon_code = serializer.validated_data.get('coupon_code', '').strip()
        trade_credit_total = serializer.validated_data.get('trade_credit_total') or Decimal('0')
        coupon_obj = None
        discount_applied = Decimal('0')
        if coupon_code:
            try:
                coupon_obj = Coupon.objects.select_for_update().get(code__iexact=coupon_code)
            except Coupon.DoesNotExist:
                return Response({'error': 'Invalid coupon code.'}, status=status.HTTP_400_BAD_REQUEST)
            if not coupon_obj.is_valid:
                return Response({'error': 'This coupon has expired or reached its usage limit.'}, status=status.HTTP_400_BAD_REQUEST)

            has_trade = trade_credit_total > 0 or bool(trade_cards)
            if coupon_obj.requires_cash_only and has_trade:
                return Response({'error': 'This coupon cannot be used with trade-in orders.'}, status=status.HTTP_400_BAD_REQUEST)

            if coupon_obj.min_order_total:
                eligible_cash = max(Decimal('0'), sale_price - trade_credit_total)
                if eligible_cash < coupon_obj.min_order_total:
                    return Response({
                        'error': f'This coupon requires a minimum cash total of ${coupon_obj.min_order_total:.2f}.',
                    }, status=status.HTTP_400_BAD_REQUEST)

            # Specific product restriction: only count eligible items
            product_ids = set(coupon_obj.specific_products.values_list('id', flat=True))
            if product_ids:
                eligible_total = sum(
                    item_objs[ci['item_id']].price * ci['quantity']
                    for ci in cart_items if ci['item_id'] in product_ids
                )
            else:
                eligible_total = sale_price

            if eligible_total > 0:
                if coupon_obj.discount_amount:
                    discount_applied = min(coupon_obj.discount_amount, eligible_total)
                elif coupon_obj.discount_percent:
                    discount_applied = (eligible_total * coupon_obj.discount_percent / Decimal('100')).quantize(Decimal('0.01'))
                    discount_applied = min(discount_applied, eligible_total)

        discounted_price = sale_price - discount_applied

        # --- Trade credit calculation ---
        oracle_cards_by_key = {}
        if trade_cards:
            oracle_lookup_keys = {
                (card.get('tcg_product_id'), card.get('tcg_sub_type') or 'Normal')
                for card in trade_cards
                if card.get('tcg_product_id')
            }
            if oracle_lookup_keys:
                oracle_filter = models.Q()
                for product_id, sub_type_name in oracle_lookup_keys:
                    oracle_filter |= models.Q(product_id=product_id, sub_type_name=sub_type_name)
                oracle_cards_by_key = {
                    (card.product_id, card.sub_type_name or 'Normal'): card
                    for card in TCGCardPrice.objects.filter(oracle_filter)
                }

        if trade_cards:
            effective_credit = Decimal('0')
            for c in trade_cards:
                tcg_pid = c.get('tcg_product_id')
                tcg_sub = c.get('tcg_sub_type') or 'Normal'
                condition = c.get('condition', 'lightly_played')
                if tcg_pid:
                    tcg_card = oracle_cards_by_key.get((tcg_pid, tcg_sub))
                    if tcg_card:
                        base_price = tcg_card.market_price or Decimal('0')
                    else:
                        bmp = c.get('base_market_price')
                        base_price = Decimal(str(bmp)) if bmp else Decimal(str(c['estimated_value']))
                    card_credit = calc_trade_credit(base_price, condition, settings.trade_credit_percentage)
                else:
                    card_credit = (Decimal(str(c['estimated_value'])) * credit_pct).quantize(Decimal('0.01'))
                effective_credit += card_credit
        else:
            effective_credit = Decimal('0')

        minimum_method = payment_method
        minimum_due = discounted_price
        if payment_method == 'cash_plus_trade':
            minimum_method = serializer.validated_data.get('backup_payment_method', '').strip()
            minimum_due = max(Decimal('0'), discounted_price - effective_credit)
        minimum_required = PAYMENT_MINIMUMS.get(minimum_method)
        if minimum_required and minimum_due > Decimal('0') and minimum_due < minimum_required:
            return Response({
                'error': f'{minimum_method.upper()} requires at least ${minimum_required:.2f}. Current amount due is ${minimum_due:.2f}.'
            }, status=status.HTTP_400_BAD_REQUEST)

        # --- Purchase limits check (per item) ---
        ACTIVE_LIMIT_STATUSES = ['pending', 'fulfilled', 'trade_review', 'cash_needed', 'pending_counteroffer']
        noon_cutoff = get_noon_reset_cutoff()
        week_cutoff = timezone.now() - timedelta(days=7)

        for ci in cart_items:
            iid = ci['item_id']
            qty = ci['quantity']
            item_preview = item_objs[iid]

            agg = OrderItem.objects.filter(
                order__user=request.user, item_id=iid,
                order__status__in=ACTIVE_LIMIT_STATUSES,
            ).aggregate(
                daily=models.Sum('quantity', filter=models.Q(order__created_at__gte=noon_cutoff)),
                weekly=models.Sum('quantity', filter=models.Q(order__created_at__gte=week_cutoff)),
                total=models.Sum('quantity'),
            )
            purchased_daily = agg['daily'] or 0
            purchased_weekly = agg['weekly'] or 0
            purchased_total = agg['total'] or 0

            if item_preview.max_per_user > 0 and purchased_daily + qty > item_preview.max_per_user:
                return Response({
                    'error': 'daily_limit_exceeded',
                    'detail': f'Daily limit exceeded for {item_preview.title}.',
                }, status=status.HTTP_400_BAD_REQUEST)

            if item_preview.max_per_week and purchased_weekly + qty > item_preview.max_per_week:
                return Response({
                    'error': 'weekly_limit_exceeded',
                    'detail': f'Weekly limit exceeded for {item_preview.title}.',
                }, status=status.HTTP_400_BAD_REQUEST)

            if item_preview.max_total_per_user and purchased_total + qty > item_preview.max_total_per_user:
                return Response({
                    'error': 'total_limit_exceeded',
                    'detail': f'Total purchase limit exceeded for {item_preview.title}.',
                }, status=status.HTTP_400_BAD_REQUEST)

        if delivery_method == 'scheduled' and not pickup_slot_id and not pickup_timeslot_id and not recurring_timeslot_id:
            return Response({'error': 'Pickup slot required for scheduled delivery'}, status=status.HTTP_400_BAD_REQUEST)

        try:
          from inventory.views import process_pending_drops
          process_pending_drops()

          with transaction.atomic():
            # Lock and deduct stock for ALL items
            for ci in cart_items:
                item = Item.objects.select_for_update().get(id=ci['item_id'], is_active=True)
                if item.stock < ci['quantity']:
                    return Response({'error': f'Insufficient stock for {item.title}'}, status=status.HTTP_400_BAD_REQUEST)
                item.stock -= ci['quantity']
                item.save()

            pickup_slot = None
            if delivery_method == 'scheduled' and pickup_slot_id:
                pickup_slot = PickupSlot.objects.select_for_update().get(id=pickup_slot_id, is_claimed=False)
                pickup_slot.is_claimed = True
                pickup_slot.save()

            pickup_timeslot = None
            if delivery_method == 'scheduled' and pickup_timeslot_id:
                pickup_timeslot = PickupTimeslot.objects.select_for_update().get(id=pickup_timeslot_id, is_active=True)
                if pickup_timeslot.active_booking_count() >= pickup_timeslot.max_bookings:
                    raise DjangoValidationError('Timeslot is fully booked')

            recurring_ts = None
            if delivery_method == 'scheduled' and recurring_timeslot_id:
                recurring_ts = RecurringTimeslot.objects.get(id=recurring_timeslot_id, is_active=True)
                if not pickup_date:
                    raise DjangoValidationError('pickup_date is required when using a recurring timeslot')
                if recurring_ts.active_booking_count(pickup_date=pickup_date) >= recurring_ts.max_bookings:
                    raise DjangoValidationError('This timeslot is fully booked for the selected date')

            order_status = 'trade_review' if payment_method in ('trade', 'cash_plus_trade') and trade_cards else 'pending'
            trade_overage = max(Decimal('0'), effective_credit - discounted_price)

            order = Order.objects.create(
                user=request.user,
                payment_method=payment_method,
                delivery_method=delivery_method,
                pickup_slot=pickup_slot,
                pickup_timeslot=pickup_timeslot,
                recurring_timeslot=recurring_ts,
                pickup_date=pickup_date,
                discord_handle=discord_handle,
                buy_if_trade_denied=buy_if_trade_denied,
                preferred_pickup_time=preferred_pickup_time,
                status=order_status,
                trade_overage=trade_overage,
                backup_payment_method=serializer.validated_data.get('backup_payment_method', ''),
                coupon_code=coupon_obj.code if coupon_obj else '',
                discount_applied=discount_applied,
            )

            # Create OrderItems
            for ci in cart_items:
                item_obj = item_objs[ci['item_id']]
                OrderItem.objects.create(
                    order=order,
                    item=item_obj,
                    quantity=ci['quantity'],
                    price_at_purchase=item_obj.price,
                )

            if pickup_timeslot:
                pickup_timeslot.refresh_current_bookings(save=True)

            # Create trade offer
            if trade_cards:
                trade_offer = TradeOffer.objects.create(
                    order=order,
                    total_credit=effective_credit,
                    credit_percentage=settings.trade_credit_percentage,
                    trade_mode=trade_mode,
                )
                for i, card_data in enumerate(trade_cards):
                    tcg_pid = card_data.get('tcg_product_id')
                    tcg_sub = card_data.get('tcg_sub_type') or 'Normal'
                    base_mp = card_data.get('base_market_price')
                    if tcg_pid and not base_mp:
                        tcg_card = oracle_cards_by_key.get((tcg_pid, tcg_sub))
                        if tcg_card:
                            base_mp = tcg_card.market_price
                    photo = request.FILES.get(f'trade_photo_{i}') or request.FILES.get(f'trade_card_photo_{i}')
                    TradeCardItem.objects.create(
                        trade_offer=trade_offer,
                        card_name=card_data['card_name'],
                        estimated_value=card_data['estimated_value'],
                        condition=card_data.get('condition', 'lightly_played'),
                        rarity=card_data.get('rarity', ''),
                        is_wanted_card=card_data.get('is_wanted_card', False),
                        tcg_product_id=tcg_pid,
                        tcg_sub_type=tcg_sub,
                        base_market_price=base_mp,
                        custom_price=card_data.get('custom_price'),
                        photo=photo or '',
                    )

            if coupon_obj:
                Coupon.objects.filter(id=coupon_obj.id).update(times_used=models.F('times_used') + 1)

          items_desc = ', '.join(f'{item_objs[ci["item_id"]].title} x{ci["quantity"]}' for ci in cart_items)
          append_timeline(order, 'order_placed', f'Order placed for {items_desc}.')
          order.save()

          return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)
        except DjangoValidationError as e:
            return Response({'error': e.message}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.exception('Checkout failed: %s', e)
            return Response({'error': 'An unexpected error occurred during checkout.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DispatchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not request.user.is_admin:
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)

        orders = Order.objects.filter(
            status__in=Order.ACTIVE_ORDER_STATUSES
        ).select_related('user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot').prefetch_related('order_items__item', 'trade_offer__cards')

        # Filtering
        status_filter = request.query_params.get('status')
        if status_filter:
            orders = orders.filter(status=status_filter)

        payment_filter = request.query_params.get('payment_method')
        if payment_filter:
            orders = orders.filter(payment_method=payment_filter)

        search = request.query_params.get('search')
        if search:
            orders = orders.filter(
                models.Q(user__email__icontains=search) |
                models.Q(discord_handle__icontains=search) |
                models.Q(order_items__item__title__icontains=search)
            ).distinct()

        orders = orders.order_by('-created_at')
        serializer = OrderSerializer(orders, many=True)
        return Response(serializer.data)

    def post(self, request):
        if not request.user.is_admin:
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        order_id = request.data.get('order_id')
        action = request.data.get('action')  # fulfill / cancel / deny_trade / approve_trade / review_partial_trade / send_counteroffer / acknowledge_asap

        if action not in ('fulfill', 'cancel', 'deny_trade', 'approve_trade', 'review_partial_trade', 'send_counteroffer', 'acknowledge_asap'):
            return Response({'error': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)

        try:
          with transaction.atomic():
            order = Order.objects.select_for_update(of=('self',)).select_related(
                'user',
            ).prefetch_related('order_items__item').get(id=order_id, status__in=Order.ACTIVE_ORDER_STATUSES)

            if action == 'acknowledge_asap':
                if order.delivery_method != 'asap':
                    return Response({'error': 'Only ASAP orders can be acknowledged.'}, status=status.HTTP_400_BAD_REQUEST)
                if order.is_acknowledged:
                    return Response(OrderSerializer(order).data)
                order.is_acknowledged = True
                append_timeline(order, 'asap_acknowledged', 'ASAP order acknowledged by admin and moved into active dispatch handling.')
            elif action == 'fulfill':
                if order.status in ('trade_review', 'pending_counteroffer'):
                    return Response({'error': 'Cannot fulfill an order with unresolved trade review.'}, status=status.HTTP_400_BAD_REQUEST)
                order.status = 'fulfilled'
                append_timeline(order, 'fulfilled', 'Order marked as fulfilled by admin.')
            elif action == 'approve_trade':
                if order.status != 'trade_review':
                    return Response({'error': 'Can only approve trade on orders under trade review.'}, status=status.HTTP_400_BAD_REQUEST)
                order.status = 'pending'
                append_timeline(order, 'trade_approved', 'All trade cards approved by admin.')
            elif action == 'review_partial_trade':
                # Per-card accept/reject for partial trades
                card_decisions = request.data.get('card_decisions', {})
                if not card_decisions:
                    return Response({'error': 'card_decisions required for partial trade review'}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    trade_offer = order.trade_offer
                except TradeOffer.DoesNotExist:
                    return Response({'error': 'No trade offer found for this order'}, status=status.HTTP_400_BAD_REQUEST)

                if trade_offer.trade_mode != 'allow_partial':
                    return Response({'error': 'This trade offer does not allow partial review. Use approve_trade or deny_trade instead.'}, status=status.HTTP_400_BAD_REQUEST)

                credit_pct = _decimal_percentage(trade_offer.credit_percentage)
                new_credit = Decimal('0')
                for card in trade_offer.cards.select_for_update():
                    raw_decision = card_decisions.get(str(card.id))
                    # Support both flat ("accept") and nested ({"decision": "accept", "overridden_value": 5.00}) formats
                    if isinstance(raw_decision, dict):
                        decision = raw_decision.get('decision')
                        override_val = raw_decision.get('overridden_value')
                    else:
                        decision = raw_decision
                        override_val = None

                    if decision == 'accept':
                        card.is_accepted = True
                        card.approved = True
                        if override_val is not None:
                            try:
                                card.admin_override_value = Decimal(str(override_val)).quantize(Decimal('0.01'))
                            except Exception:
                                card.admin_override_value = None
                        # Use admin override if set, otherwise calculate standard credit
                        if card.admin_override_value is not None:
                            new_credit += card.admin_override_value
                        elif card.base_market_price:
                            # Oracle card - apply condition multiplier to base market price
                            card_credit = calc_trade_credit(
                                card.base_market_price,
                                card.condition,
                                trade_offer.credit_percentage,
                            )
                            new_credit += card_credit
                        else:
                            # Manual card - estimated_value already condition-adjusted
                            card_credit = (card.estimated_value * _decimal_percentage(trade_offer.credit_percentage)).quantize(Decimal('0.01'))
                            new_credit += card_credit
                    elif decision == 'reject':
                        card.is_accepted = False
                        card.approved = False
                        card.admin_override_value = None
                    card.save()
                trade_offer.total_credit = new_credit
                trade_offer.save()

                sale_price = _order_sale_price(order)
                discount = order.discount_applied or Decimal('0')
                discounted_total = sale_price - discount
                cash_due = max(Decimal('0.00'), discounted_total - new_credit)
                timeline_msg = (
                    f"Partial trade reviewed: "
                    f"Sale price: ${sale_price:.2f}"
                    + (f", Coupon: -${discount:.2f}" if discount > 0 else "")
                    + f", Subtotal: ${discounted_total:.2f}"
                    + f", Trade credit: -${new_credit:.2f}"
                    + f", Cash due: ${cash_due:.2f}"
                )
                append_timeline(order, 'partial_review', timeline_msg)

                if new_credit >= discounted_total:
                    # Accepted cards cover the total - approve as trade
                    order.status = 'pending'
                elif new_credit > 0:
                    # Partial credit - switch to cash + trade
                    order.status = 'cash_needed'
                    order.payment_method = 'cash_plus_trade'
                else:
                    # All cards rejected
                    if order.buy_if_trade_denied:
                        order.status = 'cash_needed'
                        order.payment_method = 'venmo'
                        append_timeline(order, 'all_cards_rejected', 'All trade cards rejected. Switched to cash payment.')
                    else:
                        order.status = 'cancelled'
                        append_timeline(order, 'all_cards_rejected', 'All trade cards rejected. Order cancelled.')
                        _restore_order_stock(order)
                        if order.pickup_slot:
                            order.pickup_slot.is_claimed = False
                            order.pickup_slot.save()
                        if order.pickup_timeslot:
                            order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
                            order.pickup_timeslot.save()
            elif action == 'cancel':
                order.status = 'cancelled'
                append_timeline(order, 'cancelled', 'Order cancelled by admin.')
                _restore_order_stock(order)
                if order.pickup_slot:
                    order.pickup_slot.is_claimed = False
                    order.pickup_slot.save()
                if order.pickup_timeslot:
                    order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
                    order.pickup_timeslot.save()
            elif action == 'deny_trade':
                if order.status not in ('trade_review', 'pending_counteroffer'):
                    return Response({'error': 'Can only deny trade on orders under trade review or pending counteroffer.'}, status=status.HTTP_400_BAD_REQUEST)
                # Reset multi-card trade offer data
                try:
                    trade_offer = order.trade_offer
                    trade_offer.total_credit = Decimal('0')
                    trade_offer.save()
                    trade_offer.cards.all().update(is_accepted=False, approved=False, admin_override_value=None)
                except TradeOffer.DoesNotExist:
                    pass
                order.trade_overage = Decimal('0')
                if order.buy_if_trade_denied:
                    order.status = 'cash_needed'
                    order.payment_method = 'venmo'
                    order.trade_card_value = Decimal('0.00')
                    append_timeline(order, 'trade_denied', 'Trade denied by admin. Switched to cash payment.')
                else:
                    order.status = 'cancelled'
                    append_timeline(order, 'trade_denied', 'Trade denied by admin. Order cancelled.')
                    _restore_order_stock(order)
                    if order.pickup_slot:
                        order.pickup_slot.is_claimed = False
                        order.pickup_slot.save()
                    if order.pickup_timeslot:
                        order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
                        order.pickup_timeslot.save()
            elif action == 'send_counteroffer':
                if order.status == 'cash_needed':
                    return Response({'error': 'Cannot send counteroffer on a cash-needed order.'}, status=status.HTTP_400_BAD_REQUEST)
                # Admin sends a counteroffer - update card overrides and set status
                card_decisions = request.data.get('card_decisions', {})
                message = sanitize_plain_text(request.data.get('counteroffer_message', ''), multiline=True, max_length=1000)
                try:
                    trade_offer = order.trade_offer
                except TradeOffer.DoesNotExist:
                    return Response({'error': 'No trade offer found for this order'}, status=status.HTTP_400_BAD_REQUEST)

                credit_pct = _decimal_percentage(trade_offer.credit_percentage)
                new_credit = Decimal('0')
                for card in trade_offer.cards.select_for_update():
                    raw_decision = card_decisions.get(str(card.id))
                    if isinstance(raw_decision, dict):
                        decision = raw_decision.get('decision')
                        override_val = raw_decision.get('overridden_value')
                    else:
                        decision = raw_decision
                        override_val = None

                    if decision == 'accept':
                        card.is_accepted = True
                        card.approved = True
                        if override_val is not None:
                            try:
                                card.admin_override_value = Decimal(str(override_val)).quantize(Decimal('0.01'))
                            except Exception:
                                card.admin_override_value = None
                        if card.admin_override_value is not None:
                            new_credit += card.admin_override_value
                        elif card.base_market_price:
                            new_credit += calc_trade_credit(card.base_market_price, card.condition, trade_offer.credit_percentage)
                        else:
                            new_credit += (card.estimated_value * credit_pct).quantize(Decimal('0.01'))
                    elif decision == 'reject':
                        card.is_accepted = False
                        card.approved = False
                        card.admin_override_value = None
                    card.save()
                trade_offer.total_credit = new_credit
                trade_offer.save()

                order.status = 'pending_counteroffer'
                order.counteroffer_message = message
                order.counteroffer_expires_at = timezone.now() + timedelta(hours=24)
                append_timeline(order, 'counteroffer_sent', f'Counteroffer sent: ${new_credit:.2f} credit.' + (f' "{message}"' if message else ''))

            if action != 'cancel' and order.delivery_method == 'asap' and order.status != 'cancelled':
                order.is_acknowledged = True

            order.save()
            if order.pickup_timeslot:
                order.pickup_timeslot.refresh_current_bookings(save=True)

          return Response(OrderSerializer(order).data)
        except Order.DoesNotExist:
            return Response({'error': 'Order not found or is locked (already fulfilled/cancelled).'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.exception('Dispatch action failed: %s', e)
            return Response({'error': 'An unexpected error occurred.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AdminOrderHistoryView(generics.ListAPIView):
    """All orders (all statuses) for admin review."""
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if not self.request.user.is_admin:
            return Order.objects.none()
        return Order.objects.all().select_related(
            'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
        ).prefetch_related('order_items__item', 'trade_offer__cards').order_by('-created_at')


class OverdueOrdersView(generics.ListAPIView):
    """Scheduled active orders whose pickup window has already passed."""
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if not self.request.user.is_admin:
            return Order.objects.none()

        now = timezone.now()
        today = timezone.localdate()
        return (
            Order.objects
            .filter(
                delivery_method='scheduled',
                status__in=Order.ACTIVE_SLOT_STATUSES,
                requires_rescheduling=False,
            )
            .filter(
                models.Q(pickup_date__lt=today)
                |
                models.Q(pickup_date__isnull=True, pickup_timeslot__start__lt=now)
            )
            .select_related('user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot')
            .prefetch_related('order_items__item', 'trade_offer__cards')
            .order_by('pickup_date', 'created_at')
        )


class UserOrdersView(generics.ListAPIView):
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Order.objects.filter(user=self.request.user).select_related(
            'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
        ).prefetch_related('order_items__item', 'trade_offer__cards').order_by('-created_at')


class PurchaseLimitsView(APIView):
    """Return per-item purchase counts (daily/weekly/total) for the authenticated user."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        noon_cutoff = get_noon_reset_cutoff()
        week_cutoff = timezone.now() - timedelta(days=7)
        active_statuses = ['pending', 'fulfilled', 'trade_review', 'cash_needed', 'pending_counteroffer']

        user_orders = (
            OrderItem.objects.filter(
                order__user=request.user,
                order__status__in=active_statuses,
            )
            .values('item_id')
            .annotate(
                purchased_daily=models.Sum('quantity', filter=models.Q(order__created_at__gte=noon_cutoff)),
                purchased_weekly=models.Sum('quantity', filter=models.Q(order__created_at__gte=week_cutoff)),
                purchased_total=models.Sum('quantity'),
            )
        )
        purchase_map = {
            row['item_id']: row for row in user_orders
        }

        # Allow filtering by specific item IDs
        item_ids_param = request.query_params.get('item_ids', '').strip()
        if item_ids_param:
            try:
                requested_ids = [int(x) for x in item_ids_param.split(',') if x.strip()]
            except ValueError:
                return Response({'error': 'item_ids must be comma-separated integers.'}, status=status.HTTP_400_BAD_REQUEST)
            items = Item.objects.filter(id__in=requested_ids, is_active=True).values('id', 'max_per_user', 'max_per_week', 'max_total_per_user')
        elif request.query_params.get('all'):
            items = Item.objects.filter(is_active=True).values('id', 'max_per_user', 'max_per_week', 'max_total_per_user')
        else:
            items = Item.objects.filter(id__in=purchase_map.keys()).values('id', 'max_per_user', 'max_per_week', 'max_total_per_user')

        limits = {}
        for item in items:
            item_id = item['id']
            row = purchase_map.get(item_id, {})
            pd = row.get('purchased_daily') or 0
            pw = row.get('purchased_weekly') or 0
            pt = row.get('purchased_total') or 0
            max_day = item['max_per_user']
            max_week = item['max_per_week']
            max_total = item['max_total_per_user']

            remaining_day = None if max_day <= 0 else max(0, max_day - pd)
            remaining_week = None if not max_week else max(0, max_week - pw)
            remaining_total = None if not max_total else max(0, max_total - pt)

            # Effective remaining is the tightest non-null constraint
            candidates = [v for v in (remaining_day, remaining_week, remaining_total) if v is not None]
            remaining = min(candidates) if candidates else None

            limits[str(item_id)] = {
                'purchased_24h': pd,
                'purchased_week': pw,
                'purchased_total': pt,
                'max_per_user': max_day,
                'max_per_week': max_week,
                'max_total_per_user': max_total,
                'remaining_day': remaining_day,
                'remaining_week': remaining_week,
                'remaining_total': remaining_total,
                'remaining': remaining,
            }
        return Response(limits)


class TicketCreateAPIView(APIView):
    authentication_classes = []
    permission_classes = [HasBotAPIKey]

    def post(self, request):
        serializer = SupportTicketCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        discord_user_id = serializer.validated_data['discord_user_id']
        discord_channel_id = serializer.validated_data['discord_channel_id']
        order_uuid = serializer.validated_data.get('order_id')

        existing_ticket = SupportTicket.objects.filter(discord_channel_id=discord_channel_id).first()
        if existing_ticket:
            request.bot_api_key.mark_used()
            return Response(SupportTicketSerializer(existing_ticket).data, status=status.HTTP_200_OK)

        user_profile = UserProfile.objects.filter(discord_id=discord_user_id).select_related('user').first()
        linked_user = user_profile.user if user_profile else None

        linked_order = None
        if order_uuid:
            linked_order = Order.objects.filter(order_id=order_uuid).select_related('user').first()
            if not linked_order:
                return Response({'error': 'Order not found.'}, status=status.HTTP_400_BAD_REQUEST)
            if linked_user and linked_order.user_id != linked_user.id:
                return Response({'error': 'Order does not belong to the linked Discord user.'}, status=status.HTTP_400_BAD_REQUEST)

        ticket = SupportTicket.objects.create(
            user=linked_user,
            order=linked_order,
            discord_user_id=discord_user_id,
            discord_channel_id=discord_channel_id,
            subject=serializer.validated_data['subject'],
            initial_message=serializer.validated_data.get('initial_message', ''),
            metadata=serializer.validated_data.get('metadata', {}),
        )
        request.bot_api_key.mark_used()
        return Response(SupportTicketSerializer(ticket).data, status=status.HTTP_201_CREATED)


class TicketCloseAPIView(APIView):
    authentication_classes = []
    permission_classes = [HasBotAPIKey]

    def post(self, request):
        discord_channel_id = sanitize_plain_text(
            str(request.data.get('discord_channel_id', '')), max_length=32
        )
        if not discord_channel_id:
            return Response({'error': 'discord_channel_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        ticket = SupportTicket.objects.filter(discord_channel_id=discord_channel_id).first()
        if not ticket:
            return Response({'error': 'Ticket not found.'}, status=status.HTTP_404_NOT_FOUND)

        if ticket.status == 'closed':
            request.bot_api_key.mark_used()
            return Response(SupportTicketSerializer(ticket).data, status=status.HTTP_200_OK)

        ticket.status = 'closed'
        ticket.closed_at = timezone.now()
        ticket.save(update_fields=['status', 'closed_at', 'updated_at'])
        request.bot_api_key.mark_used()
        return Response(SupportTicketSerializer(ticket).data, status=status.HTTP_200_OK)


class DiscordHeartbeatView(APIView):
    authentication_classes = []
    permission_classes = [HasBotAPIKey]

    def post(self, request):
        actions = collect_discord_heartbeat_actions()
        request.bot_api_key.mark_used()
        return Response({'actions': actions, 'count': len(actions)})


class CancelOrderView(APIView):
    """Allow order owner to cancel their own order."""
    permission_classes = [IsAuthenticated]

    CANCELLABLE_STATUSES = ['pending', 'cash_needed', 'trade_review', 'pending_counteroffer']

    def post(self, request):
        order_id = request.data.get('order_id')
        if not order_id:
            return Response({'error': 'order_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                order = Order.objects.select_for_update(of=('self',)).select_related(
                    'user',
                ).prefetch_related('order_items__item').get(id=order_id, user=request.user)

                if order.status not in self.CANCELLABLE_STATUSES:
                    return Response({'error': 'This order cannot be cancelled'}, status=status.HTTP_400_BAD_REQUEST)

                # Check cancellation penalty: if pickup is within 24 hours
                penalty = False
                if order.pickup_date and order.recurring_timeslot:
                    from datetime import datetime, date
                    pickup_dt = datetime.combine(
                        order.pickup_date, order.recurring_timeslot.start_time
                    )
                    pickup_dt = timezone.make_aware(pickup_dt) if timezone.is_naive(pickup_dt) else pickup_dt
                    if (pickup_dt - timezone.now()).total_seconds() < 86400:
                        penalty = True
                elif order.pickup_timeslot and order.pickup_timeslot.start:
                    if (order.pickup_timeslot.start - timezone.now()).total_seconds() < 86400:
                        penalty = True

                # Restore stock
                _restore_order_stock(order)

                # Release timeslot bookings
                if order.pickup_slot:
                    order.pickup_slot.is_claimed = False
                    order.pickup_slot.save()
                if order.pickup_timeslot:
                    order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
                    order.pickup_timeslot.save()

                order.status = 'cancelled'
                order.cancelled_at = timezone.now()
                order.cancellation_penalty = penalty
                detail = 'Order cancelled by customer.'
                if penalty:
                    detail += ' Late-cancellation penalty applied.'
                append_timeline(order, 'cancelled_by_user', detail)
                order.save()
                if order.pickup_timeslot:
                    order.pickup_timeslot.refresh_current_bookings(save=True)

            return Response(OrderSerializer(order).data)
        except Order.DoesNotExist:
            return Response({'error': 'Order not found'}, status=status.HTTP_404_NOT_FOUND)


class RespondCounterOfferView(APIView):
    """Allow the order owner to accept or decline a counteroffer."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        order_id = request.data.get('order_id')
        response_action = request.data.get('response')  # 'accept', 'cancel', or 'pay_cash'

        if response_action not in ('accept', 'cancel', 'pay_cash'):
            return Response({'error': 'response must be accept, cancel, or pay_cash'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                order = Order.objects.select_for_update(of=('self',)).select_related(
                    'user',
                ).prefetch_related('order_items__item').get(id=order_id, user=request.user, status='pending_counteroffer')

                if response_action == 'accept':
                    # Move to pending - admin has already set overridden values
                    order.status = 'pending'
                    order.counteroffer_expires_at = None
                    append_timeline(order, 'counteroffer_accepted', 'Customer accepted the counteroffer.')
                    order.save()
                    if order.pickup_timeslot:
                        order.pickup_timeslot.refresh_current_bookings(save=True)
                elif response_action == 'pay_cash':
                    # User declines the trade counteroffer but wants to pay full cash instead
                    order.status = 'cash_needed'
                    order.counteroffer_expires_at = None
                    # Clear trade offer credit and reset all card decisions
                    try:
                        trade_offer = order.trade_offer
                        trade_offer.total_credit = Decimal('0')
                        trade_offer.save()
                        # Reset every card so frontend doesn't show phantom accepted credits
                        trade_offer.cards.all().update(
                            is_accepted=False,
                            approved=False,
                            admin_override_value=None,
                        )
                    except TradeOffer.DoesNotExist:
                        pass
                    order.trade_overage = Decimal('0')
                    append_timeline(order, 'counteroffer_pay_cash', 'Customer declined trade and chose to pay full cash.')
                    order.save()
                    if order.pickup_timeslot:
                        order.pickup_timeslot.refresh_current_bookings(save=True)
                else:
                    # Cancel the order + restock
                    order.status = 'cancelled'
                    order.cancelled_at = timezone.now()
                    order.counteroffer_expires_at = None
                    _restore_order_stock(order)
                    if order.pickup_slot:
                        order.pickup_slot.is_claimed = False
                        order.pickup_slot.save()
                    if order.pickup_timeslot:
                        order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
                        order.pickup_timeslot.save()
                    append_timeline(order, 'counteroffer_declined', 'Customer declined the counteroffer. Order cancelled.')
                    order.save()
                    if order.pickup_timeslot:
                        order.pickup_timeslot.refresh_current_bookings(save=True)

            return Response(OrderSerializer(order).data)
        except Order.DoesNotExist:
            return Response({'error': 'Order not found or not awaiting counteroffer'}, status=status.HTTP_404_NOT_FOUND)


class ActiveTimeslotsView(APIView):
    """Return the distinct timeslots that the current user already has active orders for."""
    permission_classes = [IsAuthenticated]

    ACTIVE_STATUSES = Order.ACTIVE_SLOT_STATUSES

    def get(self, request):
        orders = (
            Order.objects
            .filter(user=request.user, status__in=self.ACTIVE_STATUSES)
            .select_related('recurring_timeslot')
        )

        slots = []
        seen = set()
        for order in orders:
            if order.delivery_method == 'asap':
                key = 'asap'
                if key not in seen:
                    seen.add(key)
                    slots.append({'type': 'asap', 'recurring_timeslot_id': None, 'pickup_date': None, 'label': 'ASAP / Downtown'})
            elif order.recurring_timeslot and order.pickup_date:
                key = (order.recurring_timeslot_id, str(order.pickup_date))
                if key not in seen:
                    seen.add(key)
                    readable_date = order.pickup_date.strftime('%A, %b %d').replace(' 0', ' ')
                    slots.append({
                        'type': 'scheduled',
                        'recurring_timeslot_id': order.recurring_timeslot_id,
                        'pickup_date': str(order.pickup_date),
                        'label': f"{readable_date} \u2022 {order.recurring_timeslot}",
                    })

        return Response({'active_slots': slots, 'count': len(slots)})


class RescheduleOrderView(APIView):
    """Allow users to reschedule an order that was flagged due to deleted timeslot."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        order_id = request.data.get('order_id')
        recurring_timeslot_id = request.data.get('recurring_timeslot_id')
        pickup_date = request.data.get('pickup_date')

        if not all([order_id, recurring_timeslot_id, pickup_date]):
            return Response({'error': 'order_id, recurring_timeslot_id, and pickup_date are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                order = Order.objects.select_for_update().get(
                    id=order_id, user=request.user, requires_rescheduling=True
                )

                # Check deadline hasn't expired
                if order.reschedule_deadline and timezone.now() > order.reschedule_deadline:
                    return Response({'error': 'Reschedule deadline has expired. Order will be cancelled.'}, status=status.HTTP_400_BAD_REQUEST)

                new_slot = RecurringTimeslot.objects.get(id=recurring_timeslot_id, is_active=True)

                # Check bookings for this slot on this date
                from datetime import date as date_type
                if isinstance(pickup_date, str):
                    from datetime import date
                    pickup_date = date.fromisoformat(pickup_date)

                if new_slot.active_booking_count(pickup_date=pickup_date) >= new_slot.max_bookings:
                    return Response({'error': 'This timeslot is fully booked for the selected date'}, status=status.HTTP_400_BAD_REQUEST)

                order.recurring_timeslot = new_slot
                order.pickup_date = pickup_date
                order.requires_rescheduling = False
                order.reschedule_deadline = None
                order.save()

            return Response(OrderSerializer(order).data)
        except Order.DoesNotExist:
            return Response({'error': 'Order not found or does not require rescheduling'}, status=status.HTTP_404_NOT_FOUND)
        except RecurringTimeslot.DoesNotExist:
            return Response({'error': 'Timeslot not found'}, status=status.HTTP_404_NOT_FOUND)


class OrderDetailView(generics.RetrieveAPIView):
    """Retrieve a single order by UUID for receipt display. Owner or staff only."""
    permission_classes = [IsAuthenticated]
    serializer_class = OrderSerializer
    lookup_field = 'order_id'
    lookup_url_kwarg = 'order_id'

    def get_queryset(self):
        qs = Order.objects.select_related(
            'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
        ).prefetch_related('order_items__item', 'trade_offer__cards')
        if self.request.user.is_staff or getattr(self.request.user, 'is_admin', False):
            return qs
        return qs.filter(user=self.request.user)


class CouponListCreateView(generics.ListCreateAPIView):
    """Admin-only coupon CRUD - list all / create new."""
    serializer_class = CouponSerializer
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def get_queryset(self):
        if not self.request.user.is_admin:
            return Coupon.objects.none()
        return Coupon.objects.all().order_by('-created_at')

    def perform_create(self, serializer):
        if not self.request.user.is_admin:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Admin access required')
        instance = serializer.save()
        instance.full_clean()


class CouponDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Admin-only - update or delete a coupon."""
    serializer_class = CouponSerializer
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def get_queryset(self):
        if not self.request.user.is_admin:
            return Coupon.objects.none()
        return Coupon.objects.all()


class ValidateCouponView(APIView):
    """Validate a coupon code against the current cart context and return discount info with eligibility status."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        code = (request.data.get('code') or '').strip().upper()
        if not code:
            return Response({'error': 'Coupon code is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            coupon = Coupon.objects.get(code__iexact=code)
        except Coupon.DoesNotExist:
            return Response({'error': 'Invalid coupon code.'}, status=status.HTTP_404_NOT_FOUND)

        if not coupon.is_valid:
            return Response({'error': 'Sorry, this coupon has expired or reached its usage limit.'}, status=status.HTTP_400_BAD_REQUEST)

        # Optional cart context for conditional evaluation
        cart_items = request.data.get('cart_items') or []
        trade_credit = Decimal(str(request.data.get('trade_credit', 0) or 0))
        has_trade = trade_credit > 0

        cart_subtotal = sum(
            Decimal(str(ci.get('price', 0))) * int(ci.get('quantity', 1))
            for ci in cart_items
        ) if cart_items else Decimal('0')

        eligible_cash_total = max(Decimal('0'), cart_subtotal - trade_credit)

        # Base response data
        product_ids = set(coupon.specific_products.values_list('id', flat=True))
        resp = {
            'code': coupon.code,
            'discount_amount': str(coupon.discount_amount) if coupon.discount_amount else None,
            'discount_percent': str(coupon.discount_percent) if coupon.discount_percent else None,
            'min_order_total': str(coupon.min_order_total) if coupon.min_order_total else None,
            'specific_product_ids': list(product_ids),
            'requires_cash_only': coupon.requires_cash_only,
            'status': 'active',
            'disabled_reason': None,
            'computed_discount': '0',
        }

        # --- Stacking condition checks (in priority order) ---
        disabled_reason = None

        # 1. Cash-only check
        if coupon.requires_cash_only and has_trade:
            disabled_reason = 'Sorry, this coupon is not valid with trade-in orders.'

        # 2. Min order total check (against cash total after trade credit)
        if not disabled_reason and coupon.min_order_total and cart_items:
            if eligible_cash_total < coupon.min_order_total:
                disabled_reason = f'Sorry, this coupon requires a minimum cash total of ${coupon.min_order_total:.2f}.'

        # 3. Specific product check
        if not disabled_reason and product_ids and cart_items:
            matching_items = [
                ci for ci in cart_items
                if int(ci.get('item_id', 0)) in product_ids
            ]
            if not matching_items:
                disabled_reason = 'Sorry, this coupon does not apply to items in your cart.'

        if disabled_reason:
            resp['status'] = 'disabled'
            resp['disabled_reason'] = disabled_reason
            resp['computed_discount'] = '0'
            return Response(resp)

        # Compute discount amount
        if cart_items:
            if product_ids:
                # Discount applies only to the specific products' line totals
                line_total = sum(
                    Decimal(str(ci.get('price', 0))) * int(ci.get('quantity', 1))
                    for ci in cart_items
                    if int(ci.get('item_id', 0)) in product_ids
                )
            else:
                line_total = cart_subtotal

            if coupon.discount_amount:
                computed = min(coupon.discount_amount, line_total)
            elif coupon.discount_percent:
                computed = (line_total * coupon.discount_percent / Decimal('100')).quantize(Decimal('0.01'))
                computed = min(computed, line_total)
            else:
                computed = Decimal('0')
            resp['computed_discount'] = str(computed)
        else:
            resp['computed_discount'] = '0'

        return Response(resp)


class AdminDashboardView(APIView):
    """Aggregated KPIs and actionable queues for the admin dashboard."""
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def get(self, request):
        from inventory.models import Item, Category, PromoBanner

        now = timezone.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        pending_statuses = ('pending', 'trade_review', 'pending_counteroffer', 'cash_needed')

        pending_dispatches = Order.objects.filter(status__in=pending_statuses).count()
        pending_dispatches_today = Order.objects.filter(
            status__in=pending_statuses, created_at__gte=today_start
        ).count()

        todays_orders = Order.objects.filter(created_at__gte=today_start)
        todays_order_count = todays_orders.count()
        # Calculate revenue by summing over all order items in non-cancelled orders
        todays_revenue = 0
        for o in todays_orders.prefetch_related('order_items'):
            if o.status != 'cancelled':
                order_items_total = sum(float(oi.price_at_purchase) * oi.quantity for oi in o.order_items.all())
                todays_revenue += order_items_total - float(o.discount_applied)

        boxes_cat = Category.objects.filter(slug='boxes').first()
        cards_cat = Category.objects.filter(slug='cards').first()

        low_stock_boxes = Item.objects.filter(
            category=boxes_cat, stock__gt=0, stock__lt=5, is_active=True
        ).count() if boxes_cat else 0
        low_stock_cards = Item.objects.filter(
            category=cards_cat, stock__gt=0, stock__lt=2, is_active=True
        ).count() if cards_cat else 0
        low_stock = low_stock_boxes + low_stock_cards

        out_of_stock = Item.objects.filter(
            category=boxes_cat, stock=0, is_active=True
        ).count() if boxes_cat else 0

        # Build dispatch queue: one entry per order, summarize items
        dispatch_orders = (
            Order.objects.filter(
                status__in=('pending', 'trade_review', 'pending_counteroffer')
            ).prefetch_related('order_items__item', 'user').order_by('created_at')[:5]
        )
        dispatch_queue = []
        for order in dispatch_orders:
            items_summary = ', '.join(f'{oi.item.title} x{oi.quantity}' for oi in order.order_items.all())
            dispatch_queue.append({
                'id': order.id,
                'order_id': str(order.order_id),
                'status': order.status,
                'created_at': order.created_at.isoformat(),
                'items_summary': items_summary,
                'customer_email': order.user.email,
                'qty': sum(oi.quantity for oi in order.order_items.all()),
            })

        active_banners = PromoBanner.objects.filter(is_active=True).count()
        active_coupons = Coupon.objects.filter(
            is_active=True
        ).filter(
            models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=now)
        ).count()

        return Response({
            'kpis': {
                'pending_dispatches': pending_dispatches,
                'pending_dispatches_today': pending_dispatches_today,
                'todays_orders': todays_order_count,
                'todays_revenue': float(todays_revenue),
                'low_stock': low_stock,
                'out_of_stock': out_of_stock,
            },
            'dispatch_queue': dispatch_queue,
            'promotions': {
                'active_banners': active_banners,
                'active_coupons': active_coupons,
            },
        })


class CartView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = CartItem.objects.filter(user=request.user).select_related('item')
        # Prune items that are no longer active or out of stock
        stale = [ci.pk for ci in items if not ci.item.is_active]
        if stale:
            CartItem.objects.filter(pk__in=stale).delete()
            items = items.exclude(pk__in=stale)
        return Response(CartItemSerializer(items, many=True).data)

    def post(self, request):
        item_id = request.data.get('item_id')
        try:
            quantity = int(request.data.get('quantity', 1))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid quantity.'}, status=status.HTTP_400_BAD_REQUEST)
        if quantity < 1:
            return Response({'error': 'Quantity must be at least 1.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            item = Item.objects.get(pk=item_id, is_active=True)
        except Item.DoesNotExist:
            return Response({'error': 'Item not found.'}, status=status.HTTP_404_NOT_FOUND)
        ci, created = CartItem.objects.get_or_create(user=request.user, item=item, defaults={'quantity': quantity})
        if not created:
            ci.quantity = quantity
            ci.save(update_fields=['quantity'])
        return Response(CartItemSerializer(ci).data, status=status.HTTP_200_OK if not created else status.HTTP_201_CREATED)

    def delete(self, request):
        item_id = request.data.get('item_id')
        if item_id:
            CartItem.objects.filter(user=request.user, item_id=item_id).delete()
        else:
            CartItem.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CartSyncView(APIView):
    """Bulk sync: replace entire server cart with client cart."""
    permission_classes = [IsAuthenticated]

    def put(self, request):
        items = request.data.get('items', [])
        if not isinstance(items, list):
            return Response({'error': 'items must be a list.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            CartItem.objects.filter(user=request.user).delete()
            for entry in items[:50]:  # cap at 50 items
                item_id = entry.get('item_id')
                quantity = int(entry.get('quantity', 1))
                if item_id and quantity > 0:
                    try:
                        item = Item.objects.get(pk=item_id, is_active=True)
                        CartItem.objects.create(user=request.user, item=item, quantity=quantity)
                    except (Item.DoesNotExist, ValueError):
                        continue
        result = CartItem.objects.filter(user=request.user).select_related('item')
        return Response(CartItemSerializer(result, many=True).data)


class MergeCartIntoOrderView(APIView):
    """Merge the authenticated user's current cart into an existing recent order."""
    permission_classes = [IsAuthenticated]
    throttle_classes = [CheckoutThrottle]

    def post(self, request, order_id):
        # 1. Ownership check
        order = Order.objects.filter(
            order_id=order_id, user=request.user
        ).select_related('user').prefetch_related(
            'order_items__item', 'trade_offer__cards'
        ).first()
        if not order:
            return Response({'error': 'Order not found.'}, status=status.HTTP_404_NOT_FOUND)

        # 2. Status check
        MERGEABLE_STATUSES = ('pending', 'trade_review', 'cash_needed')
        if order.status not in MERGEABLE_STATUSES:
            return Response(
                {'error': f'This order cannot be modified (status: {order.status}).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 3. Recency check (within 2 days)
        age_limit = timezone.now() - timedelta(days=2)
        if order.created_at < age_limit:
            return Response(
                {'error': 'This order is too old to merge into (older than 2 days).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 4. Cart must not be empty
        cart_items = list(
            CartItem.objects.filter(user=request.user).select_related('item')
        )
        if not cart_items:
            return Response({'error': 'Your cart is empty.'}, status=status.HTTP_400_BAD_REQUEST)

        # 5. Purchase limit checks + 6. Stock checks (atomic)
        ACTIVE_LIMIT_STATUSES = ['pending', 'fulfilled', 'trade_review', 'cash_needed', 'pending_counteroffer']
        noon_cutoff = get_noon_reset_cutoff()
        week_cutoff = timezone.now() - timedelta(days=7)

        with transaction.atomic():
            added_items_desc = []
            for ci in cart_items:
                item = Item.objects.select_for_update().get(pk=ci.item_id)

                # Stock check
                if item.stock < ci.quantity:
                    return Response(
                        {'error': f'Not enough stock for {item.title} (available: {item.stock}).'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # Purchase limit check
                agg = OrderItem.objects.filter(
                    order__user=request.user, item_id=item.id,
                    order__status__in=ACTIVE_LIMIT_STATUSES,
                ).aggregate(
                    daily=models.Sum('quantity', filter=models.Q(order__created_at__gte=noon_cutoff)),
                    weekly=models.Sum('quantity', filter=models.Q(order__created_at__gte=week_cutoff)),
                    total=models.Sum('quantity'),
                )
                purchased_daily = agg['daily'] or 0
                purchased_weekly = agg['weekly'] or 0
                purchased_total = agg['total'] or 0

                if item.max_per_user > 0 and purchased_daily + ci.quantity > item.max_per_user:
                    return Response(
                        {'error': 'daily_limit_exceeded', 'detail': f'Daily limit exceeded for {item.title}.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if item.max_per_week and purchased_weekly + ci.quantity > item.max_per_week:
                    return Response(
                        {'error': 'weekly_limit_exceeded', 'detail': f'Weekly limit exceeded for {item.title}.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if item.max_total_per_user and purchased_total + ci.quantity > item.max_total_per_user:
                    return Response(
                        {'error': 'total_limit_exceeded', 'detail': f'Total purchase limit exceeded for {item.title}.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # Create OrderItem and deduct stock
                OrderItem.objects.create(
                    order=order,
                    item=item,
                    quantity=ci.quantity,
                    price_at_purchase=item.price,
                )
                item.stock -= ci.quantity
                item.save()
                added_items_desc.append(f'{item.title} x{ci.quantity}')

            # Timeline event
            n = len(cart_items)
            append_timeline(order, 'order_merged', detail=f'{n} item(s) added: {", ".join(added_items_desc)}')
            order.save()

            # Clear cart
            CartItem.objects.filter(user=request.user).delete()

        # Fire Discord notification (outside atomic block)
        from .services import notify_order_merged
        transaction.on_commit(lambda: notify_order_merged(order, added_items_desc))

        # Refresh order for serializer
        order.refresh_from_db()
        return Response(OrderSerializer(order).data, status=status.HTTP_200_OK)


# ── Admin POS Views ──────────────────────────────────────────────────────────

class AdminUserSearchView(APIView):
    """
    GET /api/orders/admin/users/search/?q=<query>
    Live user search for the admin POS.  Returns up to 10 matches by email,
    name, discord handle, or nickname.  Admin-only.
    """
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def get(self, request):
        from django.db.models import Q
        from users.models import User

        q = request.query_params.get('q', '').strip()
        if len(q) < 2:
            return Response([])

        users = (
            User.objects
            .select_related('profile')
            .filter(
                Q(email__icontains=q)
                | Q(profile__first_name__icontains=q)
                | Q(profile__last_name__icontains=q)
                | Q(profile__discord_handle__icontains=q)
                | Q(profile__nickname__icontains=q)
            )
            .distinct()[:10]
        )

        data = []
        for u in users:
            profile = getattr(u, 'profile', None)
            data.append({
                'id': u.id,
                'email': u.email,
                'first_name': profile.first_name if profile else '',
                'last_name': profile.last_name if profile else '',
                'discord_handle': profile.discord_handle if profile else '',
                'nickname': profile.nickname if profile else '',
                'is_admin': u.is_admin,
            })
        return Response(data)


class AdminPOSInventoryView(APIView):
    """
    GET /api/orders/admin/pos-inventory/
    Returns ALL active items regardless of published_at / preview_before_release,
    so admins can sell unreleased products.  Admin-only.
    """
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def get(self, request):
        from inventory.models import Item
        from inventory.serializers import ItemSerializer

        items = (
            Item.objects
            .filter(is_active=True)
            .prefetch_related('images')
            .select_related('category', 'subcategory')
            .order_by('-created_at')
        )
        serializer = ItemSerializer(items, many=True)
        return Response(serializer.data)


class AdminCreateOrderView(APIView):
    """
    POST /api/orders/admin/create/
    Create an order on behalf of a customer.
    Bypasses per-user purchase limits and release-date restrictions.
    Enforces physical stock (cannot go below zero).
    Admin-only.
    """
    permission_classes = [IsAuthenticated, IsShopAdmin]
    parser_classes = [JSONParser]

    def post(self, request):
        from .serializers import AdminCheckoutSerializer
        from users.models import User

        serializer = AdminCheckoutSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        d = serializer.validated_data
        target_user_id = d['target_user_id']
        cart_items = d['items']
        payment_method = d['payment_method']
        delivery_method = d['delivery_method']
        pickup_timeslot_id = d.get('pickup_timeslot_id')
        recurring_timeslot_id = d.get('recurring_timeslot_id')
        pickup_date = d.get('pickup_date')
        admin_notes = d.get('admin_notes', '')

        # ── Resolve target user ──────────────────────────────────────────────
        try:
            target_user = User.objects.select_related('profile').get(
                id=target_user_id, is_active=True
            )
        except User.DoesNotExist:
            return Response(
                {'error': 'Target user not found or account is inactive.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Discord handle: explicit override, then profile fallback
        discord_handle = d.get('discord_handle', '').strip()
        if not discord_handle:
            try:
                discord_handle = target_user.profile.discord_handle or ''
            except Exception:
                discord_handle = ''

        # ── Validate items ───────────────────────────────────────────────────
        item_ids = [ci['item_id'] for ci in cart_items]
        items_qs = Item.objects.filter(id__in=item_ids, is_active=True)
        items_map = {i.id: i for i in items_qs}
        missing = set(item_ids) - set(items_map.keys())
        if missing:
            return Response(
                {'error': f'Item(s) not found or inactive: {sorted(missing)}'},
                status=status.HTTP_404_NOT_FOUND,
            )

        sale_total = Decimal('0')
        for ci in cart_items:
            sale_total += items_map[ci['item_id']].price * ci['quantity']
        minimum_required = PAYMENT_MINIMUMS.get(payment_method)
        if minimum_required and sale_total > Decimal('0') and sale_total < minimum_required:
            return Response(
                {'error': f'{payment_method.upper()} requires at least ${minimum_required:.2f}. Current amount due is ${sale_total:.2f}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Delivery validation ──────────────────────────────────────────────
        if (delivery_method == 'scheduled'
                and not pickup_timeslot_id
                and not recurring_timeslot_id):
            return Response(
                {'error': 'A timeslot is required for scheduled delivery.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Atomic: stock enforcement + order creation ───────────────────────
        try:
            from inventory.views import process_pending_drops
            process_pending_drops()

            with transaction.atomic():
                # Phase 1: lock all rows and verify stock BEFORE writing anything.
                # Raising (not returning) inside the atomic block guarantees a full
                # rollback even for multi-item carts where an earlier item already
                # had its stock deducted.
                locked_items: dict[int, 'Item'] = {}
                for ci in cart_items:
                    item = Item.objects.select_for_update().get(
                        id=ci['item_id'], is_active=True
                    )
                    if item.stock < ci['quantity']:
                        raise DjangoValidationError(
                            f'Insufficient stock for "{item.title}". '
                            f'Available: {item.stock}, requested: {ci["quantity"]}.'
                        )
                    locked_items[ci['item_id']] = item

                # Phase 2: all checks passed — deduct stock using the fresh locked objects.
                for ci in cart_items:
                    item = locked_items[ci['item_id']]
                    item.stock -= ci['quantity']
                    item.save()

                # Resolve timeslot
                pickup_timeslot = None
                if delivery_method == 'scheduled' and pickup_timeslot_id:
                    pickup_timeslot = PickupTimeslot.objects.select_for_update().get(
                        id=pickup_timeslot_id, is_active=True
                    )
                    if pickup_timeslot.active_booking_count() >= pickup_timeslot.max_bookings:
                        raise DjangoValidationError('Timeslot is fully booked.')

                recurring_ts = None
                if delivery_method == 'scheduled' and recurring_timeslot_id:
                    recurring_ts = RecurringTimeslot.objects.get(
                        id=recurring_timeslot_id, is_active=True
                    )
                    if not pickup_date:
                        raise DjangoValidationError('pickup_date is required for recurring timeslots.')
                    if recurring_ts.active_booking_count(pickup_date=pickup_date) >= recurring_ts.max_bookings:
                        raise DjangoValidationError('This timeslot is fully booked for the selected date.')

                # Create order
                order = Order.objects.create(
                    user=target_user,
                    created_by=request.user,
                    payment_method=payment_method,
                    delivery_method=delivery_method,
                    pickup_timeslot=pickup_timeslot,
                    recurring_timeslot=recurring_ts,
                    pickup_date=pickup_date,
                    discord_handle=discord_handle,
                    status='pending',
                )

                # Create order items using locked_items for fresh price data.
                for ci in cart_items:
                    item = locked_items[ci['item_id']]
                    OrderItem.objects.create(
                        order=order,
                        item=item,
                        quantity=ci['quantity'],
                        price_at_purchase=item.price,
                    )

                # Audit trail
                detail = f'Admin POS order created by {request.user.email}'
                if admin_notes:
                    detail += f' — {admin_notes}'
                append_timeline(order, 'admin_created', detail)
                order.save()

        except DjangoValidationError as exc:
            return Response(
                {'error': exc.message if hasattr(exc, 'message') else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Item.DoesNotExist:
            return Response(
                {'error': 'An item became unavailable during checkout. Please refresh and try again.'},
                status=status.HTTP_409_CONFLICT,
            )
        except IntegrityError:
            return Response(
                {'error': 'The target user was deleted before the order could be created.'},
                status=status.HTTP_409_CONFLICT,
            )

        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)
