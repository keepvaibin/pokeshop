"use client";

import { useState, useRef, useEffect } from 'react';
import { ShoppingCart, User, ChevronDown, Package, Box, ClipboardList, Star, ScrollText, Settings, Tag, Key } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import Link from 'next/link';

const Navbar = () => {
  const { user } = useAuth();
  const { totalItems } = useCart();
  const [adminOpen, setAdminOpen] = useState(false);
  const adminRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
        setAdminOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="w-full">
      {/* Top Tier - Main Header */}
      <div className="bg-white dark:bg-zinc-800 px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold text-gray-800 dark:text-zinc-100 rounded-lg px-2 py-1">
          UCSC Pokeshop
        </Link>
        <div className="flex items-center space-x-4">
          <Link href="/cart" className="relative">
            <ShoppingCart className="w-6 h-6 text-gray-700 dark:text-zinc-300" />
            {totalItems > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {totalItems}
              </span>
            )}
          </Link>
          {user ? (
            <div className="flex items-center space-x-2">
              <Link href={user.is_admin ? '/admin/orders' : '/orders'} className="flex items-center gap-1 text-gray-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-sm font-medium" title="My Orders">
                <Package className="w-4 h-4" />
                <span className="hidden sm:inline">Orders</span>
              </Link>
              <User className="w-5 h-5 text-gray-700 dark:text-zinc-300" />
              <span className="text-gray-700 dark:text-zinc-300 text-sm hidden sm:inline">{user.email}</span>
              {user.is_admin && (
                <div className="relative" ref={adminRef}>
                  <button
                    onClick={() => setAdminOpen(!adminOpen)}
                    className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded-full transition-colors font-semibold text-sm"
                  >
                    Admin <ChevronDown className={`w-4 h-4 transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {adminOpen && (
                    <div className="absolute right-0 mt-2 w-48 z-50">
                      <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl overflow-hidden">
                        <Link href="/admin/dispatch" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-zinc-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors">
                          <Box size={14} className="inline mr-1" /> Dispatch
                        </Link>
                        <Link href="/admin/inventory" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-zinc-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors">
                          <ClipboardList size={14} className="inline mr-1" /> Inventory
                        </Link>
                        <Link href="/admin/wanted" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-zinc-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors">
                          <Star size={14} className="inline mr-1" /> Wanted List
                        </Link>
                        <Link href="/admin/orders" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-zinc-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors">
                          <ScrollText size={14} className="inline mr-1" /> Order History
                        </Link>
                        <Link href="/admin/coupons" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-zinc-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors">
                          <Tag size={14} className="inline mr-1" /> Coupons
                        </Link>
                        <Link href="/admin/access-codes" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-zinc-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors">
                          <Key size={14} className="inline mr-1" /> Access Codes
                        </Link>
                        <Link href="/admin/settings" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-zinc-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors">
                          <Settings size={14} className="inline mr-1" /> Settings
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!user.is_admin && (
                <Link href="/settings" className="text-zinc-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors" title="Settings">
                  <Settings className="w-5 h-5" />
                </Link>
              )}
            </div>
          ) : (
            <Link href="/login" className="bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600 transition-colors font-semibold text-sm">
              Login
            </Link>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-800"></div>

      {/* Bottom Tier - Promo Banner */}
      <div className="bg-blue-600 text-white text-center py-2 text-sm font-medium">
        Free on-campus delivery for all orders! Learn more &gt;&gt;
      </div>
    </div>
  );
};

export default Navbar;