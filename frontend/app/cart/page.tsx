"use client";

import { useCart } from '../contexts/CartContext';
import Link from 'next/link';
import Navbar from '../components/Navbar';

export default function Cart() {
  const { cart, updateQuantity, removeFromCart, totalItems } = useCart();

  return (
    <div>
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Shopping Cart</h1>
        {cart.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg mb-4">Your cart is empty.</p>
            <Link href="/" className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors">
              Continue Shopping
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {cart.map(item => (
              <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-6 flex justify-between items-center">
                <div className="flex items-center space-x-4">
                  <img src={item.image_path} alt={item.title} className="w-16 h-16 object-cover rounded" />
                  <div>
                    <h2 className="text-lg font-semibold text-gray-800">{item.title}</h2>
                    <p className="text-gray-600">{item.description}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => updateQuantity(item.id, item.quantity - 1)} 
                      className="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition-colors"
                    >
                      -
                    </button>
                    <span className="w-8 text-center">{item.quantity}</span>
                    <button 
                      onClick={() => updateQuantity(item.id, item.quantity + 1)} 
                      className="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <button 
                    onClick={() => removeFromCart(item.id)} 
                    className="text-red-500 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold">Total Items: {totalItems}</span>
                <Link 
                  href="/checkout" 
                  className="bg-blue-500 text-white px-8 py-3 rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Proceed to Checkout
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}