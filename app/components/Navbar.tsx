"use client";

import { useState, useRef, useEffect } from 'react';
import { ShoppingCart, User, LogOut, ChevronDown, Package, Box, ClipboardList, Star, ScrollText, Settings, Tag, Key } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import Link from 'next/link';

const Navbar = () => {
  const { user, logout } = useAuth();
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
      <div className="bg-white px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold text-gray-800 rounded-lg px-2 py-1">
          UCSC Pokeshop
        </Link>
        <div className="flex items-center space-x-4">
          <Link href="/cart" className="relative">
            <ShoppingCart className="w-6 h-6 text-gray-700" />
            {totalItems > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {totalItems}
              </span>
            )}
          </Link>
          {user ? (
            <div className="flex items-center space-x-2">
              <Link href="/orders" className="flex items-center gap-1 text-gray-700 hover:text-blue-600 transition-colors text-sm font-medium" title="My Orders">
                <Package className="w-4 h-4" />
                <span className="hidden sm:inline">Orders</span>
              </Link>
              <User className="w-5 h-5 text-gray-700" />
              <span className="text-gray-700 text-sm hidden sm:inline">{user.email}</span>
              {user.is_admin && (
                <div className="relative" ref={adminRef}>
                  <button
                    onClick={() => setAdminOpen(!adminOpen)}
                    className="flex items-center gap-1 bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors font-semibold text-sm"
                  >
                    Admin <ChevronDown className={`w-4 h-4 transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {adminOpen && (
                    <div className="absolute right-0 mt-2 w-48 z-50">
                      <div className="bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                        <Link href="/admin/dispatch" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                          <Box size={14} className="inline mr-1" /> Dispatch
                        </Link>
                        <Link href="/admin/inventory" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                          <ClipboardList size={14} className="inline mr-1" /> Inventory
                        </Link>
                        <Link href="/admin/wanted" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                          <Star size={14} className="inline mr-1" /> Wanted List
                        </Link>
                        <Link href="/admin/orders" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                          <ScrollText size={14} className="inline mr-1" /> Order History
                        </Link>
                        <Link href="/admin/coupons" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                          <Tag size={14} className="inline mr-1" /> Coupons
                        </Link>
                        <Link href="/admin/access-codes" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                          <Key size={14} className="inline mr-1" /> Access Codes
                        </Link>
                        <Link href="/admin/settings" onClick={() => setAdminOpen(false)} className="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                          <Settings size={14} className="inline mr-1" /> Settings
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button onClick={logout} className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-50 transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <Link href="/login" className="bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600 transition-colors font-semibold text-sm">
              Login
            </Link>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="bg-white border-b border-gray-200"></div>

      {/* Bottom Tier - Promo Banner */}
      <div className="bg-blue-600 text-white text-center py-2 text-sm font-medium">
        Free on-campus delivery for all orders! Learn more &gt;&gt;
      </div>
    </div>
  );
};

export default Navbar;