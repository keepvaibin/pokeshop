from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django.db import transaction, models
from django.shortcuts import get_object_or_404
from .models import Order
from .serializers import CheckoutSerializer, OrderSerializer
from inventory.models import Item, PickupSlot

class CheckoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = CheckoutSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        item_id = serializer.validated_data['item_id']
        quantity = serializer.validated_data['quantity']
        payment_method = serializer.validated_data['payment_method']
        delivery_method = serializer.validated_data['delivery_method']
        pickup_slot_id = serializer.validated_data.get('pickup_slot_id')
        discord_handle = serializer.validated_data['discord_handle']
        trade_card_name = serializer.validated_data.get('trade_card_name')
        trade_card_value = serializer.validated_data.get('trade_card_value')

        item = get_object_or_404(Item, id=item_id, is_active=True)

        # Check max per user
        existing_orders = Order.objects.filter(user=request.user, item=item, status__in=['pending', 'fulfilled']).aggregate(total=models.Sum('quantity'))['total'] or 0
        if existing_orders + quantity > item.max_per_user:
            return Response({'error': 'Exceeds maximum quantity per user'}, status=status.HTTP_400_BAD_REQUEST)

        pickup_slot = None
        if delivery_method == 'scheduled':
            if not pickup_slot_id:
                return Response({'error': 'Pickup slot required for scheduled delivery'}, status=status.HTTP_400_BAD_REQUEST)
            pickup_slot = get_object_or_404(PickupSlot, id=pickup_slot_id, is_claimed=False)

        with transaction.atomic():
            # Check stock
            if item.stock < quantity:
                return Response({'error': 'Insufficient stock'}, status=status.HTTP_400_BAD_REQUEST)

            # Decrement stock
            item.stock -= quantity
            item.save()

            # Claim slot
            if pickup_slot:
                pickup_slot.is_claimed = True
                pickup_slot.save()

            # Create order
            order = Order.objects.create(
                user=request.user,
                item=item,
                quantity=quantity,
                payment_method=payment_method,
                delivery_method=delivery_method,
                pickup_slot=pickup_slot,
                discord_handle=discord_handle,
                trade_card_name=trade_card_name,
                trade_card_value=trade_card_value,
            )

        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)

class DispatchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not request.user.is_admin:
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        orders = Order.objects.filter(status='pending')
        serializer = OrderSerializer(orders, many=True)
        return Response(serializer.data)

    def post(self, request):
        if not request.user.is_admin:
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        order_id = request.data.get('order_id')
        action = request.data.get('action')  # 'fulfill' or 'cancel'
        order = get_object_or_404(Order, id=order_id, status='pending')

        with transaction.atomic():
            if action == 'fulfill':
                order.status = 'fulfilled'
            elif action == 'cancel':
                order.status = 'cancelled'
                # Restock
                order.item.stock += order.quantity
                order.item.save()
                # Unclaim slot if any
                if order.pickup_slot:
                    order.pickup_slot.is_claimed = False
                    order.pickup_slot.save()
            else:
                return Response({'error': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)
            order.save()

        return Response({'message': f'Order {action}ed successfully'})
