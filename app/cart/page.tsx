"use client";

import { useState } from 'react';
import { useCart } from '../contexts/CartContext';
import { useRequireAuth } from '../hooks/useRequireAuth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import { ShoppingBag, ArrowLeft, ArrowRight, Trash2, Minus, Plus, ImageIcon, HelpCircle } from 'lucide-react';
import FallbackImage from '../components/FallbackImage';
import toast from 'react-hot-toast';
import RichText from '../components/RichText';
import { resolvePurchaseCap } from '../components/storefrontTypes';
import ConfirmModal from '../components/ConfirmModal';

const CHECKOUT_INTRO_KEY = 'sctcg_checkout_intro_seen';

export default function Cart() {
  const { user, loading: authLoading } = useRequireAuth();
  const { cart, updateQuantity, removeFromCart, totalItems } = useCart();
  const router = useRouter();
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null);

  const cartTotal = cart.reduce((sum, i) => sum + (Number(i.price) || 0) * i.quantity, 0);

  if (authLoading || !user)
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-heading font-black text-pkmn-text flex items-center gap-3 mb-2 uppercase">
            <ShoppingBag className="w-8 h-8" />
            Shopping Cart
          </h1>
          <p className="text-pkmn-gray">{totalItems === 0 ? 'Your cart is empty' : `${totalItems} item${totalItems !== 1 ? 's' : ''} in your cart`}</p>
        </div>

        {cart.length === 0 ? (
          <div className="pkc-panel border-2 border-dashed border-pkmn-border p-12 text-center">
            <ShoppingBag className="w-16 h-16 text-pkmn-gray-dark mx-auto mb-4" />
            <h2 className="text-2xl font-heading font-black text-pkmn-text mb-2 uppercase">Your cart is empty</h2>
            <p className="text-pkmn-gray mb-6">Looks like you haven&apos;t added any items yet!</p>
            <Link 
              href="/" 
              className="pkc-button-primary no-underline hover:no-underline"
            >
              <ArrowLeft size={18} />
              Continue Shopping
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Cart Items - Left Section */}
            <div className="lg:col-span-2 space-y-3">
              {cart.map(item => (
                <div 
                  key={item.id} 
                  className="pkc-panel overflow-hidden transition-colors duration-[120ms] ease-out hover:border-pkmn-gray-mid"
                >
                  <div className="p-4 flex gap-4">
                    {/* Product Image */}
                    <div className="flex-shrink-0">
                      {item.image_path ? (
                        <FallbackImage
                          src={item.image_path} 
                          alt={item.title} 
                          className="w-20 h-20 object-cover bg-pkmn-bg"
                          fallbackClassName="w-20 h-20 flex items-center justify-center bg-pkmn-bg text-pkmn-gray-dark"
                          fallbackSize={28}
                        />
                      ) : (
                        <div className="w-20 h-20 flex items-center justify-center bg-pkmn-bg text-pkmn-gray-dark">
                          <ImageIcon size={28} />
                        </div>
                      )}
                    </div>

                    {/* Product Info */}
                    <div className="flex-grow min-w-0">
                      <h3 className="text-lg font-bold text-pkmn-text">{item.title}</h3>
                      {item.price != null && Number(item.price) > 0 && (
                        <p className="text-pkmn-blue font-semibold">${Number(item.price).toFixed(2)}</p>
                      )}
                      <RichText html={item.description ?? ''} className="text-pkmn-gray text-sm [&>p]:mb-0 [&_strong]:font-semibold [&_em]:italic whitespace-normal break-words [overflow-wrap:anywhere] overflow-hidden" />
                    </div>

                    {/* Quantity & Remove */}
                    <div className="flex flex-col items-end justify-between">
                      {/* Quantity Controls */}
                      <div className="flex items-center border border-pkmn-gray-mid bg-pkmn-bg p-1">
                        <button 
                          onClick={() => {
                            if (item.quantity === 1) {
                              setPendingRemoveId(item.id);
                            } else {
                              updateQuantity(item.id, item.quantity - 1);
                            }
                          }}
                          className="p-1 hover:bg-white transition-colors duration-[120ms] ease-out text-pkmn-gray-dark"
                          title="Decrease quantity"
                        >
                          <Minus size={16} />
                        </button>
                        <span className="w-8 text-center font-semibold text-pkmn-text">{item.quantity}</span>
                        <button 
                          onClick={() => updateQuantity(item.id, Math.min(item.quantity + 1, resolvePurchaseCap(item.stock ?? 99, item.max_per_user)))} 
                          className="p-1 hover:bg-white transition-colors duration-[120ms] ease-out text-pkmn-gray-dark"
                          title="Increase quantity"
                        >
                          <Plus size={16} />
                        </button>
                      </div>

                      {/* Remove Button */}
                      <button 
                        onClick={() => setPendingRemoveId(item.id)}
                        className="text-pkmn-red hover:text-pkmn-red hover:bg-pkmn-red/10 p-2 transition-colors duration-[120ms] ease-out mt-2"
                        title="Remove from cart"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary - Right Section */}
            <div className="lg:col-span-1">
              <div className="pkc-panel sticky top-20 p-6">
                <h2 className="text-xl font-heading font-black text-pkmn-text mb-6 uppercase">Order Summary</h2>
                
                  {/* Subtotal */}
                  <div className="space-y-3 pb-5 border-b border-pkmn-border">
                    <div className="flex justify-between text-pkmn-gray-dark">
                      <span>Items</span>
                      <span className="font-semibold">{totalItems}</span>
                    </div>
                    <div className="flex justify-between text-pkmn-gray-dark">
                      <span>Subtotal</span>
                      <span className="font-semibold">
                        {cartTotal > 0 ? `$${cartTotal.toFixed(2)}` : '\u2014'}
                      </span>
                    </div>
                  </div>

                <div className="py-5 space-y-3">
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined' && !localStorage.getItem(CHECKOUT_INTRO_KEY)) {
                        setShowIntroModal(true);
                      } else {
                        router.push('/checkout');
                      }
                    }}
                    className="pkc-button-accent w-full"
                  >
                    Proceed to Checkout
                    <ArrowRight size={18} />
                  </button>
                  <Link 
                    href="/" 
                    className="pkc-button-secondary w-full no-underline hover:no-underline"
                  >
                    Continue Shopping
                  </Link>
                </div>

                <div className="text-xs text-pkmn-gray text-center pt-4 border-t border-pkmn-border">
                  Free campus pickup on all orders!
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* First-time checkout intro modal */}
      {showIntroModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white border border-pkmn-border shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <HelpCircle className="w-6 h-6 text-pkmn-blue flex-shrink-0" />
              <h2 className="text-lg font-heading font-bold text-pkmn-text">First time checking out?</h2>
            </div>
            <p className="text-sm text-pkmn-gray-dark">
              Would you like to read about how the checkout process works before placing your order?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  localStorage.setItem(CHECKOUT_INTRO_KEY, '1');
                  setShowIntroModal(false);
                  router.push('/delivery-info');
                }}
                className="flex-1 pkc-button-accent"
              >
                Yes, show me
              </button>
              <button
                onClick={() => {
                  localStorage.setItem(CHECKOUT_INTRO_KEY, '1');
                  setShowIntroModal(false);
                  router.push('/checkout');
                }}
                className="flex-1 pkc-button-secondary"
              >
                No, take me to checkout
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={pendingRemoveId !== null}
        title="Remove item?"
        description="Are you sure you would like to remove this item from your cart?"
        confirmLabel="Yes, remove"
        cancelLabel="No, keep it"
        onConfirm={() => {
          if (pendingRemoveId !== null) {
            removeFromCart(pendingRemoveId);
            toast('Item removed from cart');
            setPendingRemoveId(null);
          }
        }}
        onClose={() => setPendingRemoveId(null)}
      />
    </div>
  );
}