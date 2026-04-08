"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import { AlertCircle } from 'lucide-react';

interface PickupSlot {
  id: number;
  date_time: string;
}

export default function Checkout() {
  const { cart, clearCart } = useCart();
  const { user } = useAuth();
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('');
  const [pickupSlots, setPickupSlots] = useState<PickupSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [discordHandle, setDiscordHandle] = useState('');
  const [tradeCardName, setTradeCardName] = useState('');
  const [tradeCardValue, setTradeCardValue] = useState('');
  const [buyIfTradeDenied, setBuyIfTradeDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (deliveryMethod === 'scheduled') {
      axios.get('http://localhost:8000/api/inventory/pickup-slots/')
        .then(response => setPickupSlots(response.data))
        .catch(error => console.error(error));
    }
  }, [deliveryMethod]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!paymentMethod) newErrors.paymentMethod = 'Payment method is required';
    if (!deliveryMethod) newErrors.deliveryMethod = 'Delivery method is required';
    if (deliveryMethod === 'scheduled' && !selectedSlot) newErrors.selectedSlot = 'Pickup time is required';
    
    if (!discordHandle.trim()) {
      newErrors.discordHandle = 'Discord handle is required';
    } else if (discordHandle.length < 2) {
      newErrors.discordHandle = 'Discord handle must be at least 2 characters';
    } else if (!/^[\w.#-]+$/.test(discordHandle)) {
      newErrors.discordHandle = 'Invalid Discord handle format';
    }

    if (paymentMethod === 'trade') {
      if (!tradeCardName.trim()) {
        newErrors.tradeCardName = 'Card name is required for trade-in';
      }
      if (!tradeCardValue || parseFloat(tradeCardValue) <= 0) {
        newErrors.tradeCardValue = 'Card value must be greater than $0';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !validateForm()) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      for (const item of cart) {
        await axios.post('http://localhost:8000/api/orders/checkout/', {
          item_id: item.id,
          quantity: item.quantity,
          payment_method: paymentMethod,
          delivery_method: deliveryMethod,
          pickup_slot_id: deliveryMethod === 'scheduled' ? selectedSlot : null,
          discord_handle: discordHandle.trim(),
          trade_card_name: paymentMethod === 'trade' ? tradeCardName.trim() : '',
          trade_card_value: paymentMethod === 'trade' ? parseFloat(tradeCardValue) : null,
          buy_if_trade_denied: buyIfTradeDenied,
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      clearCart();
      router.push('/success');
    } catch (error) {
      console.error(error);
      setErrors({ submit: 'Failed to process order. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Not Logged In</h1>
        <p className="text-gray-600">Please log in to proceed with checkout.</p>
      </div>
    </div>
  );

  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Checkout</h1>
        <p className="text-gray-600 mb-6">Complete your order details below</p>
        
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          {errors.submit && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-800">{errors.submit}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Payment Method */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method *</label>
              <select 
                value={paymentMethod} 
                onChange={e => {
                  setPaymentMethod(e.target.value);
                  setErrors({ ...errors, paymentMethod: '' });
                }} 
                className={`w-full p-3 border rounded-lg focus:ring-2 focus:border-transparent transition-colors ${
                  errors.paymentMethod ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                }`}
              >
                <option value="">Select Payment Method</option>
                <option value="venmo">💰 Venmo</option>
                <option value="zelle">🏦 Zelle</option>
                <option value="paypal">🅿️ PayPal</option>
                <option value="trade">🔄 Trade-In</option>
              </select>
              {errors.paymentMethod && <p className="text-red-500 text-xs mt-1">{errors.paymentMethod}</p>}
            </div>

            {/* Delivery Method */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Delivery Method *</label>
              <select 
                value={deliveryMethod} 
                onChange={e => {
                  setDeliveryMethod(e.target.value);
                  setErrors({ ...errors, deliveryMethod: '' });
                }} 
                className={`w-full p-3 border rounded-lg focus:ring-2 focus:border-transparent transition-colors ${
                  errors.deliveryMethod ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                }`}
              >
                <option value="">Select Delivery Method</option>
                <option value="scheduled">📅 Scheduled Campus Pickup</option>
                <option value="asap">🚀 ASAP Downtown Pickup</option>
              </select>
              {errors.deliveryMethod && <p className="text-red-500 text-xs mt-1">{errors.deliveryMethod}</p>}
            </div>

            {/* Pickup Slot (conditional) */}
            {deliveryMethod === 'scheduled' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Pickup Time *</label>
                <select 
                  value={selectedSlot} 
                  onChange={e => {
                    setSelectedSlot(e.target.value);
                    setErrors({ ...errors, selectedSlot: '' });
                  }} 
                  className={`w-full p-3 border rounded-lg focus:ring-2 focus:border-transparent transition-colors ${
                    errors.selectedSlot ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                  }`}
                >
                  <option value="">Select Pickup Time</option>
                  {pickupSlots.map(slot => (
                    <option key={slot.id} value={slot.id}>{slot.date_time}</option>
                  ))}
                </select>
                {errors.selectedSlot && <p className="text-red-500 text-xs mt-1">{errors.selectedSlot}</p>}
              </div>
            )}

            {/* Discord Handle */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Discord Handle *</label>
              <input
                type="text"
                value={discordHandle}
                onChange={e => {
                  setDiscordHandle(e.target.value);
                  setErrors({ ...errors, discordHandle: '' });
                }}
                className={`w-full p-3 border rounded-lg focus:ring-2 focus:border-transparent transition-colors ${
                  errors.discordHandle ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                }`}
                placeholder="e.g., YourName#1234"
              />
              <p className="text-gray-500 text-xs mt-1">We'll use this to contact you about your order</p>
              {errors.discordHandle && <p className="text-red-500 text-xs mt-1">{errors.discordHandle}</p>}
            </div>

            {/* Trade-In Fields (conditional) */}
            {paymentMethod === 'trade' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 space-y-4">
                <h3 className="font-semibold text-blue-900">🔄 Trade-In Details</h3>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Card Name *</label>
                  <input
                    type="text"
                    value={tradeCardName}
                    onChange={e => {
                      setTradeCardName(e.target.value);
                      setErrors({ ...errors, tradeCardName: '' });
                    }}
                    className={`w-full p-3 border rounded-lg focus:ring-2 focus:border-transparent transition-colors ${
                      errors.tradeCardName ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                    }`}
                    placeholder="e.g., Charizard VMAX, Blastoise EX"
                  />
                  {errors.tradeCardName && <p className="text-red-500 text-xs mt-1">{errors.tradeCardName}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Estimated Value ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tradeCardValue}
                    onChange={e => {
                      setTradeCardValue(e.target.value);
                      setErrors({ ...errors, tradeCardValue: '' });
                    }}
                    className={`w-full p-3 border rounded-lg focus:ring-2 focus:border-transparent transition-colors ${
                      errors.tradeCardValue ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                    }`}
                    placeholder="0.00"
                  />
                  {errors.tradeCardValue && <p className="text-red-500 text-xs mt-1">{errors.tradeCardValue}</p>}
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="buyIfTradeDenied"
                    checked={buyIfTradeDenied}
                    onChange={e => setBuyIfTradeDenied(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="buyIfTradeDenied" className="ml-2 text-sm text-gray-700">
                    If my trade offer is not accepted, I wish to purchase this item with cash instead.
                  </label>
                </div>
              </div>
            )}

            {/* Submit Button */}
            {paymentMethod === 'trade' && tradeCardValue ? (
              parseFloat(tradeCardValue) >= cart.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0) ? (
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? '⏳ Processing...' : '🔄 Confirm Straight Trade'}
                </button>
              ) : (
                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gray-400 text-gray-600 font-bold py-3 px-6 rounded-lg cursor-not-allowed"
                    title="Trade value must be at least the item price"
                  >
                    🔄 Straight Trade (Insufficient Value)
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? '⏳ Processing...' : '💰 Pay Full Cash'}
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Pay $${(cart.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0) - parseFloat(tradeCardValue)).toFixed(2)} difference`}
                    >
                      {loading ? '⏳ Processing...' : `💸 Trade + Pay $${(cart.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0) - parseFloat(tradeCardValue)).toFixed(2)}`}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {loading ? '⏳ Processing...' : '✅ Confirm Reservation'}
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}