"use client";

import { useCart } from '../contexts/CartContext';
import { useRequireAuth } from '../hooks/useRequireAuth';
import Link from 'next/link';
import Navbar from '../components/Navbar';
import { ShoppingBag, ArrowLeft, Trash2, Minus, Plus, ImageIcon } from 'lucide-react';
import FallbackImage from '../components/FallbackImage';
import toast from 'react-hot-toast';
import RichText from '../components/RichText';

export default function Cart() {
  const { user, loading: authLoading } = useRequireAuth();
  const { cart, updateQuantity, removeFromCart, totalItems } = useCart();

  const cartTotal = cart.reduce((sum, i) => sum + (Number(i.price) || 0) * i.quantity, 0);

  if (authLoading || !user)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-zinc-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-zinc-400">Redirecting to login&hellip;</p>
        </div>
      </div>
    );

  return (
    <div className="bg-gray-50 dark:bg-zinc-950 min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-black text-gray-900 dark:text-zinc-100 flex items-center gap-3 mb-2">
            <ShoppingBag className="w-8 h-8" />
            Shopping Cart
          </h1>
          <p className="text-gray-600 dark:text-zinc-400">{totalItems === 0 ? 'Your cart is empty' : `${totalItems} item${totalItems !== 1 ? 's' : ''} in your cart`}</p>
        </div>

        {cart.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 border-2 border-dashed border-gray-300 dark:border-zinc-800 rounded-2xl p-12 text-center">
            <ShoppingBag className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 dark:text-zinc-400 mb-2">Your cart is empty</h2>
            <p className="text-gray-600 dark:text-zinc-400 mb-6">Looks like you haven&apos;t added any items yet!</p>
            <Link 
              href="/" 
              className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 text-zinc-50 dark:text-zinc-100 font-bold px-8 py-3 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all"
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
                  className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="p-4 flex gap-4">
                    {/* Product Image */}
                    <div className="flex-shrink-0">
                      {item.image_path ? (
                        <FallbackImage
                          src={item.image_path} 
                          alt={item.title} 
                          className="w-20 h-20 object-cover rounded-lg bg-gray-100 dark:bg-zinc-900"
                          fallbackClassName="w-20 h-20 flex items-center justify-center rounded-lg bg-gray-200 dark:bg-zinc-800 text-gray-400"
                          fallbackSize={28}
                        />
                      ) : (
                        <div className="w-20 h-20 flex items-center justify-center rounded-lg bg-gray-200 dark:bg-zinc-800 text-gray-400">
                          <ImageIcon size={28} />
                        </div>
                      )}
                    </div>

                    {/* Product Info */}
                    <div className="flex-grow min-w-0">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">{item.title}</h3>
                      {item.price != null && Number(item.price) > 0 && (
                        <p className="text-blue-600 font-semibold">${Number(item.price).toFixed(2)}</p>
                      )}
                      <RichText html={item.description ?? ''} className="text-gray-600 dark:text-zinc-400 text-sm [&>p]:mb-0 [&_strong]:font-semibold [&_em]:italic whitespace-normal break-words [overflow-wrap:anywhere] overflow-hidden" />
                    </div>

                    {/* Quantity & Remove */}
                    <div className="flex flex-col items-end justify-between">
                      {/* Quantity Controls */}
                      <div className="flex items-center bg-gray-100 dark:bg-zinc-900 rounded-lg p-1">
                        <button 
                          onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))} 
                          className="p-1 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-800 rounded transition-colors text-gray-700 dark:text-zinc-400"
                          title="Decrease quantity"
                        >
                          <Minus size={16} />
                        </button>
                        <span className="w-8 text-center font-semibold text-gray-900 dark:text-zinc-100">{item.quantity}</span>
                        <button 
                          onClick={() => updateQuantity(item.id, item.quantity + 1)} 
                          className="p-1 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-800 rounded transition-colors text-gray-700 dark:text-zinc-400"
                          title="Increase quantity"
                        >
                          <Plus size={16} />
                        </button>
                      </div>

                      {/* Remove Button */}
                      <button 
                        onClick={() => { removeFromCart(item.id); toast('Item removed from cart'); }} 
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:bg-red-900/20 p-2 rounded transition-colors mt-2"
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
              <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6 sticky top-20">
                <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 mb-6">Order Summary</h2>
                
                  {/* Subtotal */}
                  <div className="space-y-3 pb-5 border-b border-gray-200 dark:border-zinc-800">
                    <div className="flex justify-between text-gray-700 dark:text-zinc-400">
                      <span>Items</span>
                      <span className="font-semibold">{totalItems}</span>
                    </div>
                    <div className="flex justify-between text-gray-700 dark:text-zinc-400">
                      <span>Subtotal</span>
                      <span className="font-semibold">
                        {cartTotal > 0 ? `$${cartTotal.toFixed(2)}` : '\u2014'}
                      </span>
                    </div>
                  </div>

                <div className="py-5 space-y-3">
                  <Link 
                    href="/checkout" 
                    className="w-full block text-center bg-gradient-to-r from-blue-500 to-blue-600 text-zinc-50 dark:text-zinc-100 font-bold py-4 px-6 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all active:scale-95"
                  >
                    Proceed to Checkout
                  </Link>
                  <Link 
                    href="/" 
                    className="w-full block text-center py-3 px-6 rounded-lg border-2 border-gray-300 dark:border-zinc-800 text-gray-700 dark:text-zinc-400 font-semibold hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Continue Shopping
                  </Link>
                </div>

                <div className="text-xs text-gray-500 dark:text-zinc-400 text-center pt-4 border-t border-gray-200 dark:border-zinc-800">
                  Free campus pickup on all orders!
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}