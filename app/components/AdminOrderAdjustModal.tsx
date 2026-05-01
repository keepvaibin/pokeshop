"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { API_BASE_URL as API } from '@/app/lib/api';

export interface AdminOrderAdjustItem {
  id: number;
  item?: number;
  item_title: string;
  quantity: number;
  price_at_purchase: string;
  image_path?: string | null;
}

export interface AdminOrderAdjustOrder {
  id: number;
  order_id?: string;
  user_email: string;
  payment_method: string;
  delivery_method: string;
  pickup_timeslot?: string | null;
  delivery_details?: string | null;
  status: string;
  order_items?: AdminOrderAdjustItem[];
  discount_applied?: string;
  trade_credit_applied?: string;
  store_credit_applied?: string;
}

interface AdminOrderAdjustModalProps {
  order: AdminOrderAdjustOrder;
  headers: Record<string, string>;
  onClose: () => void;
  onUpdated: (updatedOrder: AdminOrderAdjustOrder, mode: 'items' | 'order') => void;
  initialMode?: 'items' | 'order';
  allowItemCancellation?: boolean;
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function orderSubtotal(order: AdminOrderAdjustOrder): number {
  return (order.order_items ?? []).reduce((sum, item) => sum + Number(item.price_at_purchase) * item.quantity, 0);
}

function orderNetDue(order: AdminOrderAdjustOrder): number {
  return Math.max(
    0,
    orderSubtotal(order)
      - Number(order.discount_applied || 0)
      - Number(order.trade_credit_applied || 0)
      - Number(order.store_credit_applied || 0),
  );
}

export default function AdminOrderAdjustModal({
  order,
  headers,
  onClose,
  onUpdated,
  initialMode = 'order',
  allowItemCancellation = true,
}: AdminOrderAdjustModalProps) {
  const orderItems = order.order_items ?? [];
  const canCancelItems = allowItemCancellation && orderItems.length > 1 && ['pending', 'cash_needed'].includes(order.status);
  const [mode, setMode] = useState<'items' | 'order'>(canCancelItems && initialMode === 'items' ? 'items' : 'order');
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(canCancelItems && initialMode === 'items' ? 'items' : 'order');
    setSelectedItemIds([]);
    setReason('');
    setSubmitting(false);
    setError(null);
  }, [canCancelItems, initialMode, order.id]);

  const selectedSubtotal = orderItems
    .filter((item) => selectedItemIds.includes(item.id))
    .reduce((sum, item) => sum + Number(item.price_at_purchase) * item.quantity, 0);

  const toggleItem = (itemId: number) => {
    setSelectedItemIds((prev) => (
      prev.includes(itemId)
        ? prev.filter((current) => current !== itemId)
        : [...prev, itemId]
    ));
  };

  const submit = async () => {
    if (!order.order_id) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError('A reason is required so the customer sees what changed.');
      return;
    }
    if (mode === 'items' && selectedItemIds.length === 0) {
      setError('Select at least one item to cancel.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = mode === 'items'
        ? await axios.post(
            `${API}/api/orders/${order.order_id}/cancel-items/`,
            { order_item_ids: selectedItemIds, reason: trimmedReason },
            { headers },
          )
        : await axios.post(
            `${API}/api/orders/${order.order_id}/cancel/`,
            { reason: trimmedReason },
            { headers },
          );

      const updated = response.data as AdminOrderAdjustOrder;
      onUpdated(updated, mode);
      toast.success(mode === 'items' ? 'Order items cancelled.' : 'Order cancelled.');
      onClose();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const message = err.response?.data?.error || err.response?.data?.reason?.[0];
        setError(message || 'Unable to update the order right now.');
      } else {
        setError('Unable to update the order right now.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const pickupSummary = order.delivery_details || order.pickup_timeslot || (order.delivery_method === 'scheduled' ? 'Scheduled campus pickup' : 'ASAP / Downtown');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-2xl border border-pkmn-border bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-pkmn-border px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-pkmn-text">Adjust Order</h2>
              <p className="mt-1 text-sm text-pkmn-gray">
                Order <span className="font-mono">{order.order_id?.slice(0, 8)}...</span> for <span className="font-semibold">{order.user_email}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-sm font-semibold text-pkmn-gray-dark hover:text-pkmn-text disabled:opacity-50"
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="border border-pkmn-border bg-pkmn-bg px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pkmn-gray-dark">Amount Due</p>
              <p className="mt-1 text-sm font-bold text-pkmn-text">{formatMoney(orderNetDue(order))}</p>
            </div>
            <div className="border border-pkmn-border bg-pkmn-bg px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pkmn-gray-dark">Items</p>
              <p className="mt-1 text-sm font-bold text-pkmn-text">{orderItems.length}</p>
            </div>
            <div className="border border-pkmn-border bg-pkmn-bg px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pkmn-gray-dark">Pickup</p>
              <p className="mt-1 text-sm font-bold text-pkmn-text">{pickupSummary}</p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            {canCancelItems && (
              <button
                type="button"
                onClick={() => setMode('items')}
                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${mode === 'items' ? 'bg-pkmn-blue text-white' : 'border border-pkmn-border bg-white text-pkmn-gray-dark hover:bg-pkmn-bg'}`}
              >
                Cancel Specific Items
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode('order')}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${mode === 'order' ? 'bg-pkmn-red text-white' : 'border border-pkmn-border bg-white text-pkmn-gray-dark hover:bg-pkmn-bg'}`}
            >
              Cancel Whole Order
            </button>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          {mode === 'items' && canCancelItems ? (
            <div>
              <p className="text-sm font-semibold text-pkmn-text">Select the line items to cancel</p>
              <p className="mt-1 text-xs text-pkmn-gray">
                The remaining items stay on the order and the totals will recalculate automatically.
              </p>
              <div className="mt-3 space-y-2">
                {orderItems.map((item) => {
                  const lineTotal = Number(item.price_at_purchase) * item.quantity;
                  const checked = selectedItemIds.includes(item.id);
                  return (
                    <label key={item.id} className={`flex cursor-pointer items-start justify-between gap-3 border px-3 py-3 transition-colors ${checked ? 'border-pkmn-blue bg-pkmn-blue/5' : 'border-pkmn-border bg-white hover:bg-pkmn-bg'}`}>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(item.id)}
                          className="mt-1 h-4 w-4 rounded border-pkmn-border text-pkmn-blue focus:ring-pkmn-blue"
                        />
                        <div>
                          <p className="text-sm font-semibold text-pkmn-text">{item.item_title}</p>
                          <p className="text-xs text-pkmn-gray">Qty {item.quantity} • {formatMoney(Number(item.price_at_purchase))} each</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-pkmn-text">{formatMoney(lineTotal)}</span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-3 rounded-md border border-pkmn-border bg-pkmn-bg px-3 py-2 text-xs text-pkmn-gray-dark">
                Selected total: <span className="font-semibold text-pkmn-text">{formatMoney(selectedSubtotal)}</span>
                {selectedItemIds.length === orderItems.length && selectedItemIds.length > 0 ? ' • Selecting every line will cancel the whole order.' : ''}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-pkmn-red/20 bg-pkmn-red/5 px-4 py-3 text-sm text-pkmn-gray-dark">
              The full order will be cancelled, inventory will be restocked, the pickup slot will be released, and the customer will receive the reason you enter below.
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-pkmn-gray">Reason (sent to customer)</label>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              maxLength={1000}
              placeholder={mode === 'items' ? 'e.g. One item had a pricing issue and was removed from the order.' : 'e.g. Out of stock after quality check.'}
              className="w-full rounded-md border border-pkmn-border px-3 py-2 text-sm text-pkmn-text focus:border-transparent focus:ring-2 focus:ring-pkmn-red"
            />
          </div>

          {error && <p className="text-sm font-semibold text-pkmn-red">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-pkmn-border bg-white px-4 py-2 text-sm font-semibold text-pkmn-gray-dark hover:bg-pkmn-bg disabled:opacity-50"
            >
              Keep Order
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !reason.trim() || (mode === 'items' && selectedItemIds.length === 0)}
              className="rounded-md bg-pkmn-red px-4 py-2 text-sm font-semibold text-white hover:bg-pkmn-red/90 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : mode === 'items' ? 'Cancel Selected Items' : 'Cancel Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}