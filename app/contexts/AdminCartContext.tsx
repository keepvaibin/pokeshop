"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface AdminCartItem {
  item_id: number;
  title: string;
  price: string;        // decimal string e.g. "14.99"
  quantity: number;
  stock: number;        // current stock — used as the hard cap
  image_path: string;
  published_at: string | null;
}

interface AdminCartContextValue {
  cart: AdminCartItem[];
  addItem: (item: Omit<AdminCartItem, 'quantity'>, qty?: number) => void;
  removeItem: (itemId: number) => void;
  updateQuantity: (itemId: number, qty: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
}

const AdminCartContext = createContext<AdminCartContextValue | null>(null);

export function AdminCartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<AdminCartItem[]>([]);

  const addItem = useCallback(
    (item: Omit<AdminCartItem, 'quantity'>, qty = 1) => {
      setCart(prev => {
        const existing = prev.find(c => c.item_id === item.item_id);
        if (existing) {
          const newQty = Math.min(existing.quantity + qty, item.stock);
          return prev.map(c =>
            c.item_id === item.item_id ? { ...c, quantity: newQty } : c,
          );
        }
        return [...prev, { ...item, quantity: Math.min(qty, item.stock) }];
      });
    },
    [],
  );

  const removeItem = useCallback((itemId: number) => {
    setCart(prev => prev.filter(c => c.item_id !== itemId));
  }, []);

  const updateQuantity = useCallback((itemId: number, qty: number) => {
    setCart(prev =>
      prev.map(c => {
        if (c.item_id !== itemId) return c;
        const clamped = Math.max(1, Math.min(qty, c.stock));
        return { ...c, quantity: clamped };
      }),
    );
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = cart.reduce(
    (sum, c) => sum + parseFloat(c.price) * c.quantity,
    0,
  );

  return (
    <AdminCartContext.Provider
      value={{ cart, addItem, removeItem, updateQuantity, clearCart, totalItems, totalPrice }}
    >
      {children}
    </AdminCartContext.Provider>
  );
}

export function useAdminCart(): AdminCartContextValue {
  const ctx = useContext(AdminCartContext);
  if (!ctx) throw new Error('useAdminCart must be used within AdminCartProvider');
  return ctx;
}
