"use client";

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Package, Plus, X } from 'lucide-react';
import FallbackImage from './FallbackImage';

export interface MergeableOrder {
  order_id: string;
  short_id: string;
  status: string;
  created_at: string;
  item_count: number;
  order_items: { id: number; item_title: string; quantity: number; price_at_purchase: string }[];
  trade_credit: number;
  discount_applied: number;
  coupon_code: string;
  delivery_method: string;
  pickup_label: string | null;
}

export interface CartItem {
  id: number;
  title: string;
  price: number;
  quantity: number;
  image_path?: string;
}

interface Props {
  order: MergeableOrder;
  cartItems: CartItem[];
  hasTradeCards?: boolean;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  trade_review: 'Trade Review',
  cash_needed: 'Cash Needed',
};

const backdrop = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] as const } },
};

const panel = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const } },
  exit: { opacity: 0, y: 16, transition: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] as const } },
};

export default function OrderMergePreviewModal({ order, cartItems, hasTradeCards, open, onClose, onConfirm }: Props) {
  const cartTotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const existingSubtotal = order.order_items.reduce((s, oi) => s + Number(oi.price_at_purchase) * oi.quantity, 0);
  const combinedSubtotal = existingSubtotal + cartTotal;
  const tradeCredit = order.trade_credit || 0;
  const discount = order.discount_applied || 0;
  const combinedTotal = Math.max(0, combinedSubtotal - discount - tradeCredit);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-pkmn-border shadow-lg"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-pkmn-border p-5">
              <div>
                <h2 className="text-lg font-heading font-bold text-pkmn-text uppercase">Merge Into Order</h2>
                <p className="text-xs text-pkmn-gray mt-0.5">
                  #{order.short_id} &middot; {STATUS_LABELS[order.status] || order.status} &middot; {new Date(order.created_at).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center border border-pkmn-border bg-white text-pkmn-text transition-colors duration-[120ms] ease-out hover:border-pkmn-blue hover:text-pkmn-blue"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Existing order items */}
              <div>
                <p className="text-xs font-heading font-bold uppercase tracking-wider text-pkmn-gray mb-2">
                  <Package size={12} className="inline mr-1" /> Current Order ({order.order_items.length} item{order.order_items.length !== 1 ? 's' : ''})
                </p>
                <div className="space-y-2">
                  {order.order_items.map((oi) => (
                    <div key={oi.id} className="flex items-center justify-between bg-pkmn-bg px-3 py-2 text-sm">
                      <span className="text-pkmn-text truncate mr-2">{oi.item_title}</span>
                      <span className="text-pkmn-gray flex-shrink-0">{oi.quantity} &times; ${Number(oi.price_at_purchase).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Divider with plus icon */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-pkmn-border" />
                <div className="flex items-center justify-center w-7 h-7 border border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue">
                  <Plus size={14} />
                </div>
                <div className="flex-1 border-t border-pkmn-border" />
              </div>

              {/* Cart items to add */}
              <div>
                <p className="text-xs font-heading font-bold uppercase tracking-wider text-pkmn-gray mb-2">
                  Adding From Cart ({cartItems.length} item{cartItems.length !== 1 ? 's' : ''})
                </p>
                <div className="space-y-2">
                  {cartItems.map((ci) => (
                    <div key={ci.id} className="flex items-center gap-3 bg-pkmn-blue/5 border border-pkmn-blue/15 px-3 py-2 text-sm">
                      {ci.image_path ? (
                        <FallbackImage src={ci.image_path} alt={ci.title} className="w-8 h-8 object-cover bg-pkmn-bg" fallbackClassName="w-8 h-8 flex items-center justify-center bg-pkmn-bg text-pkmn-gray-dark" fallbackSize={14} />
                      ) : (
                        <div className="w-8 h-8 bg-pkmn-bg" />
                      )}
                      <span className="text-pkmn-text truncate flex-1">{ci.title}</span>
                      <span className="text-pkmn-gray flex-shrink-0">{ci.quantity} &times; ${ci.price.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-right text-sm font-semibold text-pkmn-text mt-2">
                  Cart Total: ${cartTotal.toFixed(2)}
                </p>
              </div>

              {/* Amber trade-in banner */}
              <div className="flex items-start gap-2 bg-pkmn-yellow/10 border border-pkmn-yellow/20 px-4 py-3 text-sm text-pkmn-yellow-dark">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <p>Trade-in cards cannot be added during a merge. Only cart items will be appended to the order.</p>
              </div>

              {hasTradeCards && (
                <div className="flex items-start gap-2 bg-pkmn-red/10 border border-pkmn-red/20 px-4 py-3 text-sm text-pkmn-red">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <p>You have trade-in cards entered in the checkout form. Remove them before merging into an existing order.</p>
                </div>
              )}

              {/* Combined total breakdown */}
              <div className="bg-pkmn-bg p-4 text-sm space-y-1.5">
                <div className="flex justify-between text-pkmn-gray-dark">
                  <span>Existing Order Subtotal</span>
                  <span className="text-pkmn-text">${existingSubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-pkmn-gray-dark">
                  <span>+ Cart Items</span>
                  <span className="text-pkmn-text">${cartTotal.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Coupon ({order.coupon_code})</span>
                    <span>-${discount.toFixed(2)}</span>
                  </div>
                )}
                {tradeCredit > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Trade Credit</span>
                    <span>-${tradeCredit.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-pkmn-text border-t border-pkmn-border pt-1.5">
                  <span>Combined Total</span>
                  <span>${combinedTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-pkmn-border p-5 flex gap-3">
              <button type="button" onClick={onClose} className="pkc-button-secondary flex-1">
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!!hasTradeCards}
                className="pkc-button-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue to Confirm
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
