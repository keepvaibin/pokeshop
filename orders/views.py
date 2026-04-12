from decimal import Decimal

import json
import logging

from rest_framework import status, generics
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.throttling import UserRateThrottle
from django.db import transaction, models
from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import timedelta, time as dt_time
from users.models import UserProfile
from users.permissions import HasBotAPIKey

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
from .serializers import CheckoutSerializer, OrderSerializer, CouponSerializer, SupportTicketCreateSerializer, SupportTicketSerializer
from inventory.models import Item, PickupSlot, PokeshopSettings, PickupTimeslot, RecurringTimeslot, TCGCardPrice
from inventory.trade_utils import calc_trade_credit, normalize_condition
from .models import Order, TradeOffer, TradeCardItem, Coupon, SupportTicket
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
        # Support both JSON body and FormData (for photo uploads).
        # IMPORTANT: Never call request.data.copy() - deepcopy chokes on file streams.
        data = {k: v for k, v in request.data.items()}

        # Parse scalar string fields that FormData sends as strings
        for bool_field in ('buy_if_trade_denied',):
            if isinstance(data.get(bool_field), str):
                data[bool_field] = data[bool_field].lower() in ('true', '1', 'yes')

        # --- Extract trade card data BEFORE serializer validation ---
        # Accept both 'trade_offer_data' (new) and 'trade_cards' (legacy) keys
        trade_data_raw = data.pop('trade_offer_data', None) or data.pop('trade_cards', None) or '[]'
        trade_mode = data.pop('trade_mode', 'all_or_nothing')
        if isinstance(trade_mode, str) and trade_mode not in ('all_or_nothing', 'allow_partial'):
            trade_mode = 'all_or_nothing'

        # Parse trade card JSON
        if isinstance(trade_data_raw, str):
            try:
                trade_cards = json.loads(trade_data_raw)
            except (json.JSONDecodeError, TypeError):
                return Response({'error': 'Invalid trade card data - could not parse JSON.'}, status=status.HTTP_400_BAD_REQUEST)
        elif isinstance(trade_data_raw, list):
            trade_cards = trade_data_raw
        else:
            trade_cards = []

        # Validate trade cards manually
        if trade_cards:
            for i, c in enumerate(trade_cards):
                if not isinstance(c, dict):
                    return Response({'error': f'Trade card #{i+1} is not a valid object.'}, status=status.HTTP_400_BAD_REQUEST)
                if not c.get('card_name', '').strip():
                    return Response({'error': f'Trade card #{i+1}: card_name is required.'}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    val = Decimal(str(c.get('estimated_value', 0)))
                    if val <= 0:
                        raise ValueError
                except (ValueError, TypeError):
                    return Response({'error': f'Trade card #{i+1}: estimated_value must be greater than $0.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = CheckoutSerializer(data=data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        item_id = serializer.validated_data['item_id']
        quantity = serializer.validated_data['quantity']
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
        # trade_cards and trade_mode are parsed above, outside serializer
        buy_if_trade_denied = serializer.validated_data.get('buy_if_trade_denied', False)
        preferred_pickup_time = serializer.validated_data.get('preferred_pickup_time', '')
        # Legacy single-card fields
        trade_card_name = serializer.validated_data.get('trade_card_name', '')
        trade_card_value = serializer.validated_data.get('trade_card_value')

        # Validate IDs exist before entering atomic block
        if not Item.objects.filter(id=item_id, is_active=True).exists():
            return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)

        # Load settings for trade credit percentage
        settings = PokeshopSettings.load()
        credit_pct = _decimal_percentage(settings.trade_credit_percentage)

        # Build effective trade value from multi-card or legacy single card
        item_preview = Item.objects.get(id=item_id)
        sale_price = item_preview.price * quantity

        # --- Coupon validation & discount calculation ---
        coupon_code = serializer.validated_data.get('coupon_code', '').strip()
        coupon_obj = None
        discount_applied = Decimal('0')
        if coupon_code:
            try:
                coupon_obj = Coupon.objects.get(code__iexact=coupon_code)
            except Coupon.DoesNotExist:
                return Response({'error': 'Invalid coupon code.'}, status=status.HTTP_400_BAD_REQUEST)
            if not coupon_obj.is_valid:
                return Response({'error': 'This coupon has expired or reached its usage limit.'}, status=status.HTTP_400_BAD_REQUEST)
            if coupon_obj.discount_amount:
                discount_applied = min(coupon_obj.discount_amount, sale_price)
            elif coupon_obj.discount_percent:
                discount_applied = (sale_price * coupon_obj.discount_percent / Decimal('100')).quantize(Decimal('0.01'))
                discount_applied = min(discount_applied, sale_price)

        # Discounted subtotal after coupon
        discounted_price = sale_price - discount_applied

        if trade_cards:
            # Calculate trade credit using TCG oracle when available
            effective_credit = Decimal('0')
            for c in trade_cards:
                tcg_pid = c.get('tcg_product_id')
                tcg_sub = c.get('tcg_sub_type', '')
                condition = c.get('condition', 'lightly_played')
                if tcg_pid:
                    # Oracle lookup - authoritative price
                    try:
                        tcg_card = TCGCardPrice.objects.get(product_id=tcg_pid, sub_type_name=tcg_sub or 'Normal')
                        base_price = tcg_card.market_price or Decimal('0')
                    except TCGCardPrice.DoesNotExist:
                        # Fallback: use frontend's base_market_price snapshot
                        bmp = c.get('base_market_price')
                        base_price = Decimal(str(bmp)) if bmp else Decimal(str(c['estimated_value']))
                    card_credit = calc_trade_credit(base_price, condition, settings.trade_credit_percentage)
                else:
                    # Manual entry - estimated_value is the user's condition-adjusted value,
                    # so only apply credit percentage (no condition multiplier)
                    card_credit = (Decimal(str(c['estimated_value'])) * credit_pct).quantize(Decimal('0.01'))
                effective_credit += card_credit
            raw_total = sum(Decimal(str(c['estimated_value'])) for c in trade_cards)
        elif trade_card_value:
            raw_total = Decimal(str(trade_card_value))
            effective_credit = (raw_total * credit_pct).quantize(Decimal('0.01'))
        else:
            raw_total = Decimal('0')
            effective_credit = Decimal('0')

        # Check max per user - noon-based daily reset
        noon_cutoff = get_noon_reset_cutoff()
        existing_orders = Order.objects.filter(
            user=request.user, item_id=item_id,
            status__in=['pending', 'fulfilled', 'trade_review', 'cash_needed', 'pending_counteroffer'],
            created_at__gte=noon_cutoff,
        ).aggregate(total=models.Sum('quantity'))['total'] or 0
        if item_preview.max_per_user > 0 and existing_orders + quantity > item_preview.max_per_user:
            return Response({
                'error': 'daily_limit_exceeded',
                'detail': f'You have already purchased {existing_orders} of this item since the last reset at noon (limit: {item_preview.max_per_user}).',
                'purchased_24h': existing_orders,
                'max_per_user': item_preview.max_per_user,
            }, status=status.HTTP_400_BAD_REQUEST)

        if delivery_method == 'scheduled' and not pickup_slot_id and not pickup_timeslot_id and not recurring_timeslot_id:
            return Response({'error': 'Pickup slot required for scheduled delivery'}, status=status.HTTP_400_BAD_REQUEST)

        try:
          # Process any overdue inventory drops before checking stock
          from inventory.views import process_pending_drops
          process_pending_drops()

          with transaction.atomic():
            # Lock item row to prevent concurrent oversell
            item = Item.objects.select_for_update().get(id=item_id, is_active=True)

            if item.stock < quantity:
                return Response({'error': 'Insufficient stock'}, status=status.HTTP_400_BAD_REQUEST)

            item.stock -= quantity
            item.save()

            pickup_slot = None
            if delivery_method == 'scheduled' and pickup_slot_id:
                pickup_slot = PickupSlot.objects.select_for_update().get(id=pickup_slot_id, is_claimed=False)
                pickup_slot.is_claimed = True
                pickup_slot.save()

            pickup_timeslot = None
            if delivery_method == 'scheduled' and pickup_timeslot_id:
                pickup_timeslot = PickupTimeslot.objects.select_for_update().get(id=pickup_timeslot_id, is_active=True)
                if pickup_timeslot.current_bookings >= pickup_timeslot.max_bookings:
                    raise DjangoValidationError('Timeslot is fully booked')
                pickup_timeslot.current_bookings += 1
                pickup_timeslot.save()

            recurring_ts = None
            if delivery_method == 'scheduled' and recurring_timeslot_id:
                recurring_ts = RecurringTimeslot.objects.get(id=recurring_timeslot_id, is_active=True)
                if not pickup_date:
                    raise DjangoValidationError('pickup_date is required when using a recurring timeslot')
                # Check distinct user bookings for this slot on this date
                distinct_users = Order.objects.filter(
                    recurring_timeslot=recurring_ts,
                    pickup_date=pickup_date,
                    status__in=['pending', 'fulfilled', 'trade_review', 'cash_needed', 'pending_counteroffer'],
                ).exclude(user=request.user).values('user').distinct().count()
                if distinct_users >= recurring_ts.max_bookings:
                    raise DjangoValidationError('This timeslot is fully booked for the selected date')

            order_status = 'trade_review' if payment_method in ('trade', 'cash_plus_trade') and (trade_cards or trade_card_value) else 'pending'

            # Calculate trade overage (amount shop owes user when credit > discounted price)
            trade_overage = max(Decimal('0'), effective_credit - discounted_price)

            order = Order.objects.create(
                user=request.user,
                item=item,
                quantity=quantity,
                payment_method=payment_method,
                delivery_method=delivery_method,
                pickup_slot=pickup_slot,
                pickup_timeslot=pickup_timeslot,
                recurring_timeslot=recurring_ts,
                pickup_date=pickup_date,
                discord_handle=discord_handle,
                trade_card_name=trade_card_name if not trade_cards else '',
                trade_card_value=trade_card_value if not trade_cards else None,
                buy_if_trade_denied=buy_if_trade_denied,
                preferred_pickup_time=preferred_pickup_time,
                status=order_status,
                trade_overage=trade_overage,
                backup_payment_method=serializer.validated_data.get('backup_payment_method', ''),
                coupon_code=coupon_obj.code if coupon_obj else '',
                discount_applied=discount_applied,
            )

            # Create multi-card trade offer if trade_cards provided
            if trade_cards:
                trade_offer = TradeOffer.objects.create(
                    order=order,
                    total_credit=effective_credit,
                    credit_percentage=settings.trade_credit_percentage,
                    trade_mode=trade_mode,
                )
                for i, card_data in enumerate(trade_cards):
                    tcg_pid = card_data.get('tcg_product_id')
                    tcg_sub = card_data.get('tcg_sub_type', '')
                    base_mp = card_data.get('base_market_price')
                    # If oracle card, store the base market price at time of checkout
                    if tcg_pid and not base_mp:
                        try:
                            tcg_card = TCGCardPrice.objects.get(product_id=tcg_pid, sub_type_name=tcg_sub or 'Normal')
                            base_mp = tcg_card.market_price
                        except TCGCardPrice.DoesNotExist:
                            pass
                    # Attach photo from FormData if present (keyed as trade_photo_0 or legacy trade_card_photo_0)
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

            # Increment coupon usage atomically
            if coupon_obj:
                Coupon.objects.filter(id=coupon_obj.id).update(times_used=models.F('times_used') + 1)

          append_timeline(order, 'order_placed', f'Order placed for {item.title} x{quantity}.')
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
            status__in=['pending', 'cash_needed', 'trade_review', 'pending_counteroffer']
        ).select_related('item', 'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot').prefetch_related('trade_offer__cards')

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
                models.Q(item__title__icontains=search)
            )

        orders = orders.order_by('-created_at')
        serializer = OrderSerializer(orders, many=True)
        return Response(serializer.data)

    def post(self, request):
        if not request.user.is_admin:
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        order_id = request.data.get('order_id')
        action = request.data.get('action')  # fulfill / cancel / deny_trade / approve_trade / review_partial_trade / send_counteroffer

        if action not in ('fulfill', 'cancel', 'deny_trade', 'approve_trade', 'review_partial_trade', 'send_counteroffer'):
            return Response({'error': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)

        try:
          with transaction.atomic():
            order = Order.objects.select_for_update().select_related(
                'item', 'user', 'pickup_slot', 'pickup_timeslot'
            ).get(id=order_id, status__in=['pending', 'cash_needed', 'trade_review', 'pending_counteroffer'])

            if action == 'fulfill':
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
                append_timeline(order, 'partial_review', f'Partial trade reviewed: ${new_credit:.2f} credit from accepted cards.')

                sale_price = order.item.price * order.quantity - (order.discount_applied or Decimal('0'))
                if new_credit >= sale_price:
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
                        item = Item.objects.select_for_update().get(id=order.item_id)
                        item.stock += order.quantity
                        item.save()
                        if order.pickup_slot:
                            order.pickup_slot.is_claimed = False
                            order.pickup_slot.save()
                        if order.pickup_timeslot:
                            order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
                            order.pickup_timeslot.save()
            elif action == 'cancel':
                order.status = 'cancelled'
                append_timeline(order, 'cancelled', 'Order cancelled by admin.')
                item = Item.objects.select_for_update().get(id=order.item_id)
                item.stock += order.quantity
                item.save()
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
                    item = Item.objects.select_for_update().get(id=order.item_id)
                    item.stock += order.quantity
                    item.save()
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
                message = (request.data.get('counteroffer_message', '') or '')[:1000]
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

            order.save()

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
            'item', 'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
        ).prefetch_related('trade_offer__cards').order_by('-created_at')


class UserOrdersView(generics.ListAPIView):
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Order.objects.filter(user=self.request.user).select_related(
            'item', 'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
        ).prefetch_related('trade_offer__cards').order_by('-created_at')


class PurchaseLimitsView(APIView):
    """Return per-item 24h purchase counts for the authenticated user."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        noon_cutoff = get_noon_reset_cutoff()
        recent_orders = (
            Order.objects.filter(
                user=request.user,
                status__in=['pending', 'fulfilled', 'trade_review', 'cash_needed', 'pending_counteroffer'],
                created_at__gte=noon_cutoff,
            )
            .values('item_id')
            .annotate(purchased_24h=models.Sum('quantity'))
        )
        purchased_map = {row['item_id']: row['purchased_24h'] for row in recent_orders}

        # Only return items the user has actually purchased (or all active items if ?all=1)
        if request.query_params.get('all'):
            items = Item.objects.filter(is_active=True).values('id', 'max_per_user')
        else:
            items = Item.objects.filter(id__in=purchased_map.keys()).values('id', 'max_per_user')

        limits = {}
        for item in items:
            item_id = item['id']
            max_qty = item['max_per_user']
            purchased = purchased_map.get(item_id, 0)
            limits[str(item_id)] = {
                'purchased_24h': purchased,
                'max_per_user': max_qty,
                'remaining': None if max_qty <= 0 else max(0, max_qty - purchased),
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
                order = Order.objects.select_for_update().select_related(
                    'item', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
                ).get(id=order_id, user=request.user)

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
                item = Item.objects.select_for_update().get(id=order.item_id)
                item.stock += order.quantity
                item.save()

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
                order = Order.objects.select_for_update().select_related(
                    'item', 'user', 'pickup_slot', 'pickup_timeslot'
                ).get(id=order_id, user=request.user, status='pending_counteroffer')

                if response_action == 'accept':
                    # Move to pending - admin has already set overridden values
                    order.status = 'pending'
                    order.counteroffer_expires_at = None
                    append_timeline(order, 'counteroffer_accepted', 'Customer accepted the counteroffer.')
                    order.save()
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
                else:
                    # Cancel the order + restock
                    order.status = 'cancelled'
                    order.cancelled_at = timezone.now()
                    order.counteroffer_expires_at = None
                    item = Item.objects.select_for_update().get(id=order.item_id)
                    item.stock += order.quantity
                    item.save()
                    if order.pickup_slot:
                        order.pickup_slot.is_claimed = False
                        order.pickup_slot.save()
                    if order.pickup_timeslot:
                        order.pickup_timeslot.current_bookings = max(0, order.pickup_timeslot.current_bookings - 1)
                        order.pickup_timeslot.save()
                    append_timeline(order, 'counteroffer_declined', 'Customer declined the counteroffer. Order cancelled.')
                    order.save()

            return Response(OrderSerializer(order).data)
        except Order.DoesNotExist:
            return Response({'error': 'Order not found or not awaiting counteroffer'}, status=status.HTTP_404_NOT_FOUND)


class ActiveTimeslotsView(APIView):
    """Return the distinct timeslots that the current user already has active orders for."""
    permission_classes = [IsAuthenticated]

    ACTIVE_STATUSES = ('pending', 'cash_needed', 'trade_review', 'pending_counteroffer')

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

                existing_bookings = Order.objects.filter(
                    recurring_timeslot=new_slot,
                    pickup_date=pickup_date,
                    status__in=['pending', 'fulfilled', 'trade_review', 'cash_needed', 'pending_counteroffer'],
                ).exclude(user=order.user).values('user').distinct().count()

                if existing_bookings >= new_slot.max_bookings:
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
            'item', 'user', 'pickup_slot', 'pickup_timeslot', 'recurring_timeslot'
        ).prefetch_related('trade_offer__cards')
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
    """Public endpoint to validate a coupon code and return discount info."""
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
            return Response({'error': 'This coupon has expired or reached its usage limit.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'code': coupon.code,
            'discount_amount': str(coupon.discount_amount) if coupon.discount_amount else None,
            'discount_percent': str(coupon.discount_percent) if coupon.discount_percent else None,
        })
