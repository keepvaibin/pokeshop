"use client";

import { useCart } from '../contexts/CartContext';
import Link from 'next/link';
import Navbar from '../components/Navbar';
import { ShoppingBag, ArrowLeft, Trash2, Minus, Plus } from 'lucide-react';

export default function Cart() {
  const { cart, updateQuantity, removeFromCart, totalItems } = useCart();

  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-black text-gray-900 flex items-center gap-3 mb-2">
            <ShoppingBag className="w-8 h-8" />
            Shopping Cart
          </h1>
          <p className="text-gray-600">{totalItems === 0 ? 'Your cart is empty' : `${totalItems} item${totalItems !== 1 ? 's' : ''} in your cart`}</p>
        </div>

        {cart.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center">
            <div className="text-6xl mb-4">🛍️</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Your cart is empty</h2>
            <p className="text-gray-600 mb-6">Looks like you haven't added any items yet!</p>
            <Link 
              href="/" 
              className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold px-8 py-3 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all"
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
                  className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="p-4 flex gap-4">
                    {/* Product Image */}
                    <div className="flex-shrink-0">
                      <img 
                        src={item.image_path} 
                        alt={item.title} 
                        className="w-20 h-20 object-cover rounded-lg bg-gray-100" 
                      />
                    </div>

                    {/* Product Info */}
                    <div className="flex-grow">
                      <h3 className="text-lg font-bold text-gray-900">{item.title}</h3>
                      <p className="text-gray-600 text-sm">{item.description}</p>
                    </div>

                    {/* Quantity & Remove */}
                    <div className="flex flex-col items-end justify-between">
                      {/* Quantity Controls */}
                      <div className="flex items-center bg-gray-100 rounded-lg p-1">
                        <button 
                          onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))} 
                          className="p-1 hover:bg-gray-200 rounded transition-colors text-gray-700"
                          title="Decrease quantity"
                        >
                          <Minus size={16} />
                        </button>
                        <span className="w-8 text-center font-semibold text-gray-900">{item.quantity}</span>
                        <button 
                          onClick={() => updateQuantity(item.id, item.quantity + 1)} 
                          className="p-1 hover:bg-gray-200 rounded transition-colors text-gray-700"
                          title="Increase quantity"
                        >
                          <Plus size={16} />
                        </button>
                      </div>

                      {/* Remove Button */}
                      <button 
                        onClick={() => removeFromCart(item.id)} 
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded transition-colors mt-2"
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
              <div className="bg-white border border-gray-200 rounded-lg p-6 sticky top-20">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Order Summary</h2>
                
                <div className="space-y-4 pb-6 border-b border-gray-200">
                  <div className="flex justify-between text-gray-700">
                    <span>Items</span>
                    <span className="font-semibold">{totalItems}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Subtotal</span>
                    <span className="font-semibold">-</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Shipping</span>
                    <span className="font-semibold text-green-600">Free</span>
                  </div>
                </div>

                <div className="py-6 space-y-4">
                  <Link 
                    href="/checkout" 
                    className="w-full block text-center bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-4 px-6 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all active:scale-95"
                  >
                    Proceed to Checkout
                  </Link>
                  <Link 
                    href="/" 
                    className="w-full block text-center py-3 px-6 rounded-lg border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
                  >
                    Continue Shopping
                  </Link>
                </div>

                <div className="text-xs text-gray-500 text-center pt-4 border-t border-gray-200">
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