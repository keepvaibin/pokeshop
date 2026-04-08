"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';

interface Order {
  id: number;
  item: { title: string };
  quantity: number;
  user: string;
  discord_handle: string;
}

export default function AdminDispatch() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (user?.is_admin) {
      const token = localStorage.getItem('access_token');
      axios.get('http://localhost:8000/api/orders/dispatch/', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(response => setOrders(response.data))
        .catch(error => console.error(error));
    }
  }, [user]);

  const handleAction = async (orderId: number, action: string) => {
    const token = localStorage.getItem('access_token');
    try {
      await axios.post('http://localhost:8000/api/orders/dispatch/', { order_id: orderId, action }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(orders.filter(o => o.id !== orderId));
    } catch (error) {
      console.error(error);
    }
  };

  if (!user?.is_admin) return <div>Access denied.</div>;

  return (
    <div>
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Admin Dispatch</h1>
        <div className="space-y-4">
          {orders.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
              <p className="text-gray-500">No orders pending dispatch.</p>
            </div>
          ) : (
            orders.map(order => (
              <div key={order.id} className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">Order #{order.id}</h3>
                    <p className="text-gray-600">{order.item.title} x{order.quantity}</p>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    <p>User: {order.user}</p>
                    <p>Discord: {order.discord_handle}</p>
                  </div>
                </div>
                <div className="flex space-x-3">
                  <button 
                    onClick={() => handleAction(order.id, 'fulfill')} 
                    className="bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 transition-colors"
                  >
                    Fulfill Order
                  </button>
                  <button 
                    onClick={() => handleAction(order.id, 'cancel')} 
                    className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition-colors"
                  >
                    No-Show & Restock
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}