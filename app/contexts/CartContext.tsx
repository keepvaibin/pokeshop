"use client";

import { createContext, useContext, useState, useCallback, useMemo, useRef, ReactNode } from 'react';
import { resolvePurchaseCap } from '../components/storefrontTypes';

interface Item {
  id: number;
  title: string;
  price?: number;
  quantity: number;
  image_path?: string;
  description?: string;
  max_per_user?: number;
  stock?: number;
}

type AddToCartItem = Omit<Item, 'quantity'> & { quantity?: number };

interface CartContextType {
  cart: Item[];
  addToCart: (item: AddToCartItem, desiredQty?: number) => boolean;
  removeFromCart: (itemId: number) => void;
  updateQuantity: (itemId: number, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};

interface CartProviderProps {
  children: ReactNode;
}

export const CartProvider = ({ children }: CartProviderProps) => {
  const [cart, setCart] = useState<Item[]>([]);
  const cartRef = useRef<Item[]>(cart);
  // eslint-disable-next-line react-hooks/refs
  cartRef.current = cart;

  const addToCart = useCallback((item: AddToCartItem, desiredQty: number = 1): boolean => {
    const maxQty = resolvePurchaseCap(item.stock ?? 99, item.max_per_user);
    const existing = cartRef.current.find(i => i.id === item.id);
    if (existing && existing.quantity >= maxQty) {
      return false;
    }
    setCart(prev => {
      const ex = prev.find(i => i.id === item.id);
      if (ex) {
        if (ex.quantity >= maxQty) return prev;
        return prev.map(i => i.id === item.id ? { ...i, quantity: Math.min(i.quantity + desiredQty, maxQty) } : i);
      }
      return [...prev, { ...item, quantity: Math.min(desiredQty, maxQty) }];
    });
    return true;
  }, []);

  const removeFromCart = useCallback((itemId: number) => {
    setCart(prev => prev.filter(i => i.id !== itemId));
  }, []);

  const updateQuantity = useCallback((itemId: number, quantity: number) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(i => i.id !== itemId));
    } else {
      setCart(prev => prev.map(i => {
        if (i.id !== itemId) return i;
        const cappedQuantity = resolvePurchaseCap(i.stock ?? 99, i.max_per_user);
        return { ...i, quantity: Math.min(quantity, cappedQuantity) };
      }));
    }
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const totalItems = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const value = useMemo(() => ({ cart, addToCart, removeFromCart, updateQuantity, clearCart, totalItems }), [cart, addToCart, removeFromCart, updateQuantity, clearCart, totalItems]);

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
};