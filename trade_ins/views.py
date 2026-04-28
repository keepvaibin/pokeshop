"""Trade-in API views.

Customer endpoints:
  POST   /api/trade-ins/                 Submit a trade-in
  GET    /api/trade-ins/                 List own trade-ins
  GET    /api/trade-ins/<id>/            Retrieve own trade-in detail
  GET    /api/trade-ins/wallet/          Wallet balance + ledger summary

Admin endpoints (IsShopAdmin):
  GET    /api/trade-ins/admin/           List ALL trade-ins (with filter)
  GET    /api/trade-ins/admin/<id>/      Retrieve any trade-in
  POST   /api/trade-ins/admin/<id>/approve/   Mark approved + set payout
    POST   /api/trade-ins/admin/<id>/review/    Accept/reject cards + counteroffer
    POST   /api/trade-ins/<id>/respond-counteroffer/ Accept/decline counteroffer
    POST   /api/trade-ins/admin/<id>/complete/  Cards received -> fund wallet
  POST   /api/trade-ins/admin/<id>/reject/    Reject the request
"""
from decimal import Decimal
from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import UserProfile

from .models import TradeInRequest, CreditLedger
from .serializers import (
    TradeInRequestSerializer,
    AdminTradeInReviewSerializer,
    AdminTradeInCardReviewSerializer,
    AdminTradeInRejectSerializer,
    CustomerTradeInCounterOfferResponseSerializer,
    CreditLedgerSerializer,
)
from .notifications import (
    notify_admins_new_trade_in,
    notify_customer_trade_in_approved,
    notify_customer_trade_in_counteroffer,
    notify_customer_trade_in_completed,
    notify_customer_trade_in_rejected,
    notify_admins_trade_in_counteroffer_response,
)


class IsShopAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and getattr(request.user, 'is_admin', False)
        )


# ---------------------------------------------------------------------------
# Customer endpoints
# ---------------------------------------------------------------------------

def _trade_ins_open():
    """Return True when trade-in submissions are enabled in PokeshopSettings."""
    from inventory.models import PokeshopSettings
    return PokeshopSettings.load().trade_ins_enabled


class CustomerTradeInListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = (
            TradeInRequest.objects
            .filter(user=request.user)
            .select_related('user__profile')
            .prefetch_related('items')
            .order_by('-created_at')
        )
        return Response(TradeInRequestSerializer(qs, many=True).data)

    def post(self, request):
        if not _trade_ins_open():
            return Response(
                {'detail': 'Trade-in submissions are currently closed. Check back soon!'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        serializer = TradeInRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            trade_in = serializer.save(user=request.user)
        # Fire-and-forget admin notification (doesn't fail the request).
        try:
            notify_admins_new_trade_in(trade_in)
        except Exception:
            pass
        return Response(
            TradeInRequestSerializer(trade_in).data,
            status=status.HTTP_201_CREATED,
        )


class CustomerTradeInDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        trade_in = get_object_or_404(
            TradeInRequest.objects.select_related('user__profile').prefetch_related('items'),
            pk=pk,
            user=request.user,
        )
        return Response(TradeInRequestSerializer(trade_in).data)


class WalletView(APIView):
    """Return the user's current trade-credit balance + recent ledger entries."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        recent = (
            CreditLedger.objects
            .filter(user=request.user)
            .order_by('-created_at')[:50]
        )
        return Response({
            'balance': str(profile.trade_credit_balance or Decimal('0')),
            'ledger': CreditLedgerSerializer(recent, many=True).data,
        })


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

class AdminTradeInListView(APIView):
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def get(self, request):
        status_filter = request.query_params.get('status', '').strip()
        qs = TradeInRequest.objects.select_related('user', 'user__profile', 'reviewed_by').prefetch_related('items')
        if status_filter:
            qs = qs.filter(status=status_filter)
        # Surface pending work first, then most recent.
        qs = qs.order_by(
            '-created_at',
        )
        return Response(TradeInRequestSerializer(qs, many=True).data)


class AdminTradeInDetailView(APIView):
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def get(self, request, pk):
        trade_in = get_object_or_404(
            TradeInRequest.objects.select_related('user', 'user__profile', 'reviewed_by').prefetch_related('items'),
            pk=pk,
        )
        return Response(TradeInRequestSerializer(trade_in).data)


class AdminTradeInApproveView(APIView):
    """Set final payout value and move request to APPROVED_PENDING_RECEIPT."""
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def post(self, request, pk):
        serializer = AdminTradeInReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            trade_in = get_object_or_404(
                TradeInRequest.objects.select_for_update(),
                pk=pk,
            )
            if trade_in.status != TradeInRequest.STATUS_PENDING_REVIEW:
                return Response(
                    {'error': 'Only pending trade-ins can be approved.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            trade_in.final_payout_value = serializer.validated_data['final_payout_value']
            trade_in.admin_notes = serializer.validated_data.get('admin_notes', '')
            trade_in.status = TradeInRequest.STATUS_APPROVED_PENDING_RECEIPT
            trade_in.reviewed_by = request.user
            trade_in.reviewed_at = timezone.now()
            trade_in.save()

        try:
            notify_customer_trade_in_approved(trade_in)
        except Exception:
            pass
        return Response(TradeInRequestSerializer(trade_in).data)


class AdminTradeInCardReviewView(APIView):
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def post(self, request, pk):
        serializer = AdminTradeInCardReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        decisions = serializer.validated_data['card_decisions']
        message = serializer.validated_data.get('counteroffer_message', '')
        send_counteroffer = serializer.validated_data.get('send_counteroffer', False)

        with transaction.atomic():
            trade_in = get_object_or_404(
                TradeInRequest.objects.select_for_update().prefetch_related('items'),
                pk=pk,
            )
            if trade_in.status != TradeInRequest.STATUS_PENDING_REVIEW:
                return Response(
                    {'error': 'Only trade-ins awaiting initial review can be reviewed.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            item_ids = {str(item.id) for item in trade_in.items.all()}
            if item_ids != set(decisions.keys()):
                return Response(
                    {'error': 'Every card must have an accept or reject decision.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            final_payout = Decimal('0.00')
            for item in trade_in.items.select_for_update():
                raw_decision = decisions[str(item.id)]
                if raw_decision['decision'] == 'accept':
                    item.is_accepted = True
                    override_value = raw_decision.get('overridden_value')
                    if override_value is not None:
                        item.admin_override_value = override_value
                    else:
                        item.admin_override_value = None
                    per_card_credit = item.admin_override_value if item.admin_override_value is not None else item.user_estimated_price
                    final_payout += Decimal(str(per_card_credit or 0)) * item.quantity
                else:
                    item.is_accepted = False
                    item.admin_override_value = None
                item.save(update_fields=['is_accepted', 'admin_override_value'])

            final_payout = final_payout.quantize(Decimal('0.01'))
            trade_in.final_payout_value = final_payout
            trade_in.admin_notes = message
            trade_in.reviewed_by = request.user
            trade_in.reviewed_at = timezone.now()

            if final_payout <= Decimal('0.00'):
                trade_in.status = TradeInRequest.STATUS_REJECTED
                trade_in.counteroffer_message = ''
                trade_in.counteroffer_expires_at = None
            elif send_counteroffer:
                trade_in.status = TradeInRequest.STATUS_PENDING_COUNTEROFFER
                trade_in.counteroffer_message = message
                trade_in.counteroffer_expires_at = timezone.now() + timedelta(hours=24)
            else:
                trade_in.status = TradeInRequest.STATUS_APPROVED_PENDING_RECEIPT
                trade_in.counteroffer_message = ''
                trade_in.counteroffer_expires_at = None
            trade_in.save()

        try:
            if final_payout <= Decimal('0.00'):
                notify_customer_trade_in_rejected(trade_in)
            elif send_counteroffer:
                notify_customer_trade_in_counteroffer(trade_in)
            else:
                notify_customer_trade_in_approved(trade_in)
        except Exception:
            pass
        return Response(TradeInRequestSerializer(trade_in).data)


class AdminTradeInCompleteView(APIView):
    """Cards received on campus; fund wallet atomically."""
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def post(self, request, pk):
        with transaction.atomic():
            trade_in = get_object_or_404(
                TradeInRequest.objects.select_for_update().select_related('user'),
                pk=pk,
            )
            if trade_in.status != TradeInRequest.STATUS_APPROVED_PENDING_RECEIPT:
                return Response(
                    {'error': 'Trade-in must be in approved/awaiting state to complete.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            payout = trade_in.final_payout_value or Decimal('0')
            if payout <= Decimal('0'):
                return Response(
                    {'error': 'Cannot complete trade-in with zero payout. Reject instead.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            new_balance = None
            if trade_in.payout_type == TradeInRequest.PAYOUT_TYPE_STORE_CREDIT:
                profile, _ = UserProfile.objects.select_for_update().get_or_create(
                    user=trade_in.user
                )
                profile.trade_credit_balance = (
                    (profile.trade_credit_balance or Decimal('0')) + payout
                )
                profile.save(update_fields=['trade_credit_balance'])

                CreditLedger.objects.create(
                    user=trade_in.user,
                    amount=payout,
                    transaction_type=CreditLedger.TYPE_TRADE_IN_PAYOUT,
                    reference_id=f'trade_in:{trade_in.pk}',
                    note='Trade-in payout',
                    created_by=request.user,
                )
                new_balance = profile.trade_credit_balance

            trade_in.status = TradeInRequest.STATUS_COMPLETED
            trade_in.completed_at = timezone.now()
            trade_in.save(update_fields=['status', 'completed_at', 'updated_at'])

        try:
            notify_customer_trade_in_completed(trade_in, new_balance)
        except Exception:
            pass
        return Response(TradeInRequestSerializer(trade_in).data)


class AdminTradeInRejectView(APIView):
    permission_classes = [IsAuthenticated, IsShopAdmin]

    def post(self, request, pk):
        serializer = AdminTradeInRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            trade_in = get_object_or_404(
                TradeInRequest.objects.select_for_update(),
                pk=pk,
            )
            if trade_in.status not in (
                TradeInRequest.STATUS_PENDING_REVIEW,
                TradeInRequest.STATUS_PENDING_COUNTEROFFER,
                TradeInRequest.STATUS_APPROVED_PENDING_RECEIPT,
            ):
                return Response(
                    {'error': 'Only pending, counteroffered, or awaiting-receipt trade-ins can be rejected.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            trade_in.status = TradeInRequest.STATUS_REJECTED
            trade_in.admin_notes = serializer.validated_data.get('admin_notes', '')
            trade_in.reviewed_by = request.user
            trade_in.reviewed_at = timezone.now()
            trade_in.save()

        try:
            notify_customer_trade_in_rejected(trade_in)
        except Exception:
            pass
        return Response(TradeInRequestSerializer(trade_in).data)


class CustomerTradeInCounterOfferResponseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        serializer = CustomerTradeInCounterOfferResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        response_action = serializer.validated_data['response']

        with transaction.atomic():
            trade_in = get_object_or_404(
                TradeInRequest.objects.select_for_update().prefetch_related('items'),
                pk=pk,
                user=request.user,
                status=TradeInRequest.STATUS_PENDING_COUNTEROFFER,
            )
            if trade_in.counteroffer_expires_at and timezone.now() > trade_in.counteroffer_expires_at:
                trade_in.status = TradeInRequest.STATUS_REJECTED
                trade_in.admin_notes = 'Counteroffer expired.'
                trade_in.counteroffer_expires_at = None
                trade_in.save(update_fields=['status', 'admin_notes', 'counteroffer_expires_at', 'updated_at'])
                return Response({'error': 'This counteroffer has expired.'}, status=status.HTTP_400_BAD_REQUEST)

            if response_action == 'accept':
                trade_in.status = TradeInRequest.STATUS_APPROVED_PENDING_RECEIPT
                trade_in.counteroffer_expires_at = None
                trade_in.save(update_fields=['status', 'counteroffer_expires_at', 'updated_at'])
                accepted = True
            else:
                trade_in.status = TradeInRequest.STATUS_REJECTED
                trade_in.admin_notes = 'Customer declined the counteroffer.'
                trade_in.counteroffer_expires_at = None
                trade_in.save(update_fields=['status', 'admin_notes', 'counteroffer_expires_at', 'updated_at'])
                accepted = False

        try:
            notify_admins_trade_in_counteroffer_response(trade_in, accepted=accepted)
            if accepted:
                notify_customer_trade_in_approved(trade_in)
            else:
                notify_customer_trade_in_rejected(trade_in)
        except Exception:
            pass
        return Response(TradeInRequestSerializer(trade_in).data)
