"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (deliveryMethod === 'scheduled') {
      axios.get('http://localhost:8000/api/inventory/pickup-slots/')
        .then(response => setPickupSlots(response.data))
        .catch(error => console.error(error));
    }
  }, [deliveryMethod]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

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
          discord_handle: discordHandle,
          trade_card_name: paymentMethod === 'trade' ? tradeCardName : '',
          trade_card_value: paymentMethod === 'trade' ? tradeCardValue : null,
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      clearCart();
      router.push('/success');
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return <div>Please login first.</div>;

  return (
    <div>
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Checkout</h1>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
              <select 
                value={paymentMethod} 
                onChange={e => setPaymentMethod(e.target.value)} 
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                required
              >
                <option value="">Select Payment Method</option>
                <option value="venmo">Venmo</option>
                <option value="zelle">Zelle</option>
                <option value="paypal">PayPal</option>
                <option value="trade">Trade-In</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Delivery Method</label>
              <select 
                value={deliveryMethod} 
                onChange={e => setDeliveryMethod(e.target.value)} 
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                required
              >
                <option value="">Select Delivery Method</option>
                <option value="scheduled">Scheduled Campus Pickup</option>
                <option value="asap">ASAP Downtown Pickup</option>
              </select>
            </div>
            {deliveryMethod === 'scheduled' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Pickup Slot</label>
                <select 
                  value={selectedSlot} 
                  onChange={e => setSelectedSlot(e.target.value)} 
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                  required
                >
                  <option value="">Select Pickup Time</option>
                  {pickupSlots.map(slot => (
                    <option key={slot.id} value={slot.id}>{slot.date_time}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Discord Handle</label>
              <input
                type="text"
                value={discordHandle}
                onChange={e => setDiscordHandle(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Your Discord username"
                required
              />
            </div>
            {paymentMethod === 'trade' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Card Name</label>
                  <input
                    type="text"
                    value={tradeCardName}
                    onChange={e => setTradeCardName(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., Charizard VMAX"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Estimated Value ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tradeCardValue}
                    onChange={e => setTradeCardValue(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="0.00"
                    required
                  />
                </div>
              </>
            )}
            <button 
              type="submit" 
              disabled={loading} 
              className="w-full bg-blue-500 text-white py-3 px-6 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing Reservation...' : 'Confirm Reservation'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}