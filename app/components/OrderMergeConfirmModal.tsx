"use client";

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Loader2, X } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL as API } from '@/app/lib/api';
import type { MergeableOrder, CartItem } from './OrderMergePreviewModal';

interface Props {
  order: MergeableOrder;
  cartItems: CartItem[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

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

export default function OrderMergeConfirmModal({ order, cartItems, open, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cartTotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalNewItems = cartItems.reduce((s, i) => s + i.quantity, 0);

  const handleMerge = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('access_token');
      // Defence-in-depth: validate order_id is a UUID before interpolating into URL
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.order_id)) {
        setError('Invalid order reference.');
        setLoading(false);
        return;
      }
      await axios.post(
        `${API}/api/orders/${order.order_id}/merge-cart/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      onSuccess();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const d = err.response.data;
        setError(typeof d.error === 'string' ? d.error : typeof d.detail === 'string' ? d.detail : 'Merge failed. Please try again.');
      } else {
        setError('Merge failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="relative w-full max-w-md bg-white border border-pkmn-border shadow-lg"
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
              <h2 className="text-lg font-heading font-bold text-pkmn-text uppercase">Confirm Merge</h2>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="inline-flex h-9 w-9 items-center justify-center border border-pkmn-border bg-white text-pkmn-text transition-colors duration-[120ms] ease-out hover:border-pkmn-blue hover:text-pkmn-blue disabled:opacity-50"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Warning */}
              <div className="flex items-start gap-3 bg-pkmn-yellow/10 border border-pkmn-yellow/20 p-4 text-sm">
                <AlertTriangle size={18} className="text-pkmn-yellow-dark flex-shrink-0 mt-0.5" />
                <div className="text-pkmn-yellow-dark">
                  <p className="font-semibold">This action cannot be undone.</p>
                  <p className="mt-1 opacity-80">
                    {totalNewItems} item{totalNewItems !== 1 ? 's' : ''} (${cartTotal.toFixed(2)}) from your cart will be added to order <strong>#{order.short_id}</strong>. Your cart will be cleared afterwards.
                  </p>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 bg-pkmn-red/10 border border-pkmn-red/20 p-3 text-sm text-pkmn-red">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}

              {/* Summary */}
              <div className="bg-pkmn-bg p-4 text-sm space-y-1">
                <div className="flex justify-between text-pkmn-gray-dark">
                  <span>Target Order</span>
                  <span className="font-medium text-pkmn-text">#{order.short_id}</span>
                </div>
                <div className="flex justify-between text-pkmn-gray-dark">
                  <span>Items to Add</span>
                  <span className="font-medium text-pkmn-text">{totalNewItems}</span>
                </div>
                <div className="flex justify-between text-pkmn-gray-dark">
                  <span>Additional Cost</span>
                  <span className="font-medium text-pkmn-text">${cartTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-pkmn-border p-5 flex gap-3">
              <button type="button" onClick={onClose} disabled={loading} className="pkc-button-secondary flex-1">
                Go Back
              </button>
              <button type="button" onClick={handleMerge} disabled={loading} className="pkc-button-accent flex-1 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Merging&hellip;
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle size={16} /> Merge Items
                  </span>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
