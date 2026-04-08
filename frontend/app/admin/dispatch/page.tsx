"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import { CheckCircle, XCircle, AlertCircle, CreditCard } from 'lucide-react';

interface TradeInDetails {
  trade_card_name?: string;
  trade_card_value?: string;
}

interface Order {
  id: number;
  item: { title: string };
  quantity: number;
  user: string;
  discord_handle: string;
  payment_method: string;
  trade_card_name?: string;
  trade_card_value?: string;
}

export default function AdminDispatch() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState<number | null>(null);

  useEffect(() => {
    if (user?.is_admin) {
      const token = localStorage.getItem('access_token');
      axios.get('http://localhost:8000/api/orders/dispatch/', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(response => setOrders(response.data))
        .catch(error => console.error(error))
        .finally(() => setLoading(false));
    }
  }, [user]);

  const handleAction = async (orderId: number, action: string) => {
    const token = localStorage.getItem('access_token');
    setIsProcessing(orderId);
    try {
      await axios.post('http://localhost:8000/api/orders/dispatch/', { order_id: orderId, action }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(orders.filter(o => o.id !== orderId));
    } catch (error) {
      console.error(error);
      alert('Failed to process order. Please try again.');
    } finally {
      setIsProcessing(null);
    }
  };

  if (!user?.is_admin) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-gray-800">Access Denied</h1>
        <p className="text-gray-600">You don't have permission to view this page.</p>
      </div>
    </div>
  );

  return (
    <div className="bg-gray-100 min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900">Admin Dispatch</h1>
            <p className="text-gray-600">Manage pending orders for fulfillment</p>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg border-2 border-blue-500">
            <p className="text-2xl font-bold text-blue-600">{orders.length}</p>
            <p className="text-xs text-gray-600">Pending Orders</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-gray-600 text-lg">Loading orders...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-8 sm:p-12 text-center">
            <div className="text-5xl mb-4">✅</div>
            <h3 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">All Caught Up!</h3>
            <p className="text-gray-600">No orders pending dispatch. Great work!</p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {orders.map(order => (
              <div 
                key={order.id} 
                className="bg-white border border-gray-200 rounded-lg sm:rounded-xl overflow-hidden shadow hover:shadow-md transition-shadow"
              >
                {/* Order Header */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 sm:px-6 py-4 border-b border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h3 className="text-lg sm:text-xl font-bold text-gray-900">Order #{order.id}</h3>
                      <p className="text-sm text-gray-600">{order.item.title} × {order.quantity}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {order.payment_method === 'trade' ? (
                        <div className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs sm:text-sm font-semibold flex items-center gap-1">
                          <span>🔄</span> Trade-In
                        </div>
                      ) : (
                        <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs sm:text-sm font-semibold">
                          💰 {order.payment_method.toUpperCase()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Order Details */}
                <div className="px-4 sm:px-6 py-4 space-y-3">
                  {/* Contact Info */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-gray-100">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</p>
                      <p className="text-gray-900 font-medium">{order.user}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Discord</p>
                      <p className="text-gray-900 font-medium">{order.discord_handle}</p>
                    </div>
                  </div>

                  {/* Trade-In Details (if applicable) */}
                  {order.payment_method === 'trade' && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <h4 className="font-semibold text-yellow-900 mb-3 flex items-center gap-2">
                        <span>🔄</span> Trade-In Card Details
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-yellow-700 font-semibold">Card Name</p>
                          <p className="text-yellow-900 font-bold text-lg">{order.trade_card_name || 'Not specified'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-yellow-700 font-semibold">Estimated Value</p>
                          <p className="text-yellow-900 font-bold text-lg">${order.trade_card_value || '0.00'}</p>
                        </div>
                      </div>
                      <p className="text-xs text-yellow-700 mt-2 italic">Please verify and receive the card during hand-off.</p>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="bg-gray-50 px-4 sm:px-6 py-4 flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <button 
                    onClick={() => handleAction(order.id, 'fulfill')} 
                    disabled={isProcessing === order.id}
                    className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 active:scale-95 flex items-center justify-center gap-2"
                  >
                    {isProcessing === order.id ? (
                      <>⏳ Processing...</>
                    ) : (
                      <>
                        <CheckCircle size={18} />
                        <span className="hidden sm:inline">Fulfill Order</span>
                        <span className="sm:hidden">Fulfill</span>
                      </>
                    )}
                  </button>
                  <button 
                    onClick={() => handleAction(order.id, 'cancel')} 
                    disabled={isProcessing === order.id}
                    className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 active:scale-95 flex items-center justify-center gap-2"
                  >
                    {isProcessing === order.id ? (
                      <>⏳ Processing...</>
                    ) : (
                      <>
                        <XCircle size={18} />
                        <span className="hidden sm:inline">No-Show & Restock</span>
                        <span className="sm:hidden">No-Show</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}