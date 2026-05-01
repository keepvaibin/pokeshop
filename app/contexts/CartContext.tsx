"use client";

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react';
import { resolvePurchaseCap } from '../components/storefrontTypes';
import { useAuth } from './AuthContext';
import { apiUrl } from '../lib/api';
import { getFreshAccessToken, tryRefreshToken } from '../lib/auth-refresh';

const CART_KEY = 'pokeshop_cart';
const CART_TTL = 24 * 60 * 60 * 1000;

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

function loadLocalCart(): Item[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const { items, ts } = JSON.parse(raw);
    if (Date.now() - ts > CART_TTL) {
      localStorage.removeItem(CART_KEY);
      return [];
    }
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveLocalCart(items: Item[]) {
  try {
    if (items.length === 0) localStorage.removeItem(CART_KEY);
    else localStorage.setItem(CART_KEY, JSON.stringify({ items, ts: Date.now() }));
  } catch { /* quota exceeded */ }
}

async function authedFetch(path: string, opts: RequestInit = {}) {
  const token = await getFreshAccessToken();
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
  let res = await fetch(apiUrl(path), { ...opts, headers });
  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(apiUrl(path), { ...opts, headers });
    }
  }
  return res;
}

function apiToItem(ci: Record<string, unknown>): Item {
  return {
    id: ci.item_id as number,
    title: ci.title as string,
    price: ci.price != null ? Number(ci.price) : undefined,
    quantity: ci.quantity as number,
    image_path: (ci.image_path as string) || undefined,
    description: (ci.description as string) || undefined,
    max_per_user: ci.max_per_user != null ? Number(ci.max_per_user) : undefined,
    stock: ci.stock != null ? Number(ci.stock) : undefined,
  };
}

interface CartProviderProps { children: ReactNode }

export const CartProvider = ({ children }: CartProviderProps) => {
  const [cart, setCart] = useState<Item[]>([]);
  const cartRef = useRef<Item[]>(cart);

  const { user, loading: authLoading } = useAuth();
  const isAuthed = !!user;
  const syncedRef = useRef(false);
  const skipNextPersist = useRef(false);

  useEffect(() => { cartRef.current = cart; }, [cart]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    const hydrate = async () => {
      if (isAuthed) {
        try {
          const localItems = loadLocalCart();
          if (localItems.length > 0) {
            for (const item of localItems) {
              await authedFetch('/api/orders/cart/', {
                method: 'POST',
                body: JSON.stringify({ item_id: item.id, quantity: item.quantity }),
              });
            }
            localStorage.removeItem(CART_KEY);
          }
          const res = await authedFetch('/api/orders/cart/');
          if (res.ok && !cancelled) {
            const data = await res.json();
            skipNextPersist.current = true;
            setCart(Array.isArray(data) ? data.map(apiToItem) : []);
          }
        } catch { /* network error */ }
      } else {
        const local = loadLocalCart();
        if (local.length > 0 && !cancelled) {
          skipNextPersist.current = true;
          setCart(local);
        }
      }
      syncedRef.current = true;
    };

    hydrate();
    return () => { cancelled = true; };
  }, [authLoading, isAuthed]);

  useEffect(() => {
    if (!syncedRef.current) return;
    if (skipNextPersist.current) { skipNextPersist.current = false; return; }
    if (!isAuthed) saveLocalCart(cart);
  }, [cart, isAuthed]);

  const addToCart = useCallback((item: AddToCartItem, desiredQty: number = 1): boolean => {
    const maxQty = resolvePurchaseCap(item.stock ?? 99, item.max_per_user);
    const existing = cartRef.current.find(i => i.id === item.id);
    if (existing && existing.quantity >= maxQty) return false;
    const newQty = existing ? Math.min(existing.quantity + desiredQty, maxQty) : Math.min(desiredQty, maxQty);
    setCart(prev => {
      const ex = prev.find(i => i.id === item.id);
      if (ex) {
        if (ex.quantity >= maxQty) return prev;
        return prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i);
      }
      return [...prev, { ...item, quantity: newQty }];
    });
    if (localStorage.getItem('access_token')) {
      authedFetch('/api/orders/cart/', {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id, quantity: newQty }),
      }).catch(() => {});
    }
    return true;
  }, []);

  const removeFromCart = useCallback((itemId: number) => {
    setCart(prev => prev.filter(i => i.id !== itemId));
    if (localStorage.getItem('access_token')) {
      authedFetch('/api/orders/cart/', {
        method: 'DELETE',
        body: JSON.stringify({ item_id: itemId }),
      }).catch(() => {});
    }
  }, []);

  const updateQuantity = useCallback((itemId: number, quantity: number) => {
    if (quantity <= 0) { removeFromCart(itemId); return; }
    setCart(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const cap = resolvePurchaseCap(i.stock ?? 99, i.max_per_user);
      return { ...i, quantity: Math.min(quantity, cap) };
    }));
    if (localStorage.getItem('access_token')) {
      authedFetch('/api/orders/cart/', {
        method: 'POST',
        body: JSON.stringify({ item_id: itemId, quantity }),
      }).catch(() => {});
    }
  }, [removeFromCart]);

  const clearCart = useCallback(() => {
    setCart([]);
    localStorage.removeItem(CART_KEY);
    if (localStorage.getItem('access_token')) {
      authedFetch('/api/orders/cart/', { method: 'DELETE' }).catch(() => {});
    }
  }, []);

  const totalItems = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const value = useMemo(
    () => ({ cart, addToCart, removeFromCart, updateQuantity, clearCart, totalItems }),
    [cart, addToCart, removeFromCart, updateQuantity, clearCart, totalItems]
  );

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
};