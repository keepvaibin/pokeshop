"use client";

import { ShoppingCart, User, LogOut, Search, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import Link from 'next/link';

const Navbar = () => {
  const { user, logout } = useAuth();
  const { totalItems } = useCart();

  return (
    <div className="w-full">
      {/* Top Tier - Main Header */}
      <div className="bg-white px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold text-gray-800 rounded-lg px-2 py-1">
          UCSC Pokeshop
        </Link>
        <div className="flex-1 max-w-md mx-8">
          <div className="relative">
            <input
              type="text"
              placeholder="Search products..."
              className="w-full bg-gray-100 border border-gray-200 rounded-full px-4 py-2 pl-10 text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          </div>
        </div>
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
              <User className="w-5 h-5 text-gray-700" />
              <span className="text-gray-700">{user.email}</span>
              {user.is_admin && (
                <div className="relative group">
                  <button className="flex items-center gap-1 text-gray-700 hover:text-gray-900 px-2 py-1 pt-2 rounded-full transition-colors">
                    Admin <ChevronDown className="w-4 h-4" />
                  </button>
                  <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-xl shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-200 z-20">
                    <Link href="/admin/dispatch" className="block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                      Dispatch
                    </Link>
                    <Link href="/admin/inventory" className="block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                      Inventory
                    </Link>
                  </div>
                </div>
              )}
              <button onClick={logout} className="text-red-500 hover:text-red-700">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <Link href="/login" className="bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600 transition-colors">
              Login
            </Link>
          )}
        </div>
      </div>

      {/* Middle Tier - Categories */}
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex justify-center space-x-8">
          <Link href="#" className="text-sm font-bold text-gray-600 hover:text-gray-800 transition-colors">
            New Releases
          </Link>
          <Link href="#" className="text-sm font-bold text-gray-600 hover:text-gray-800 transition-colors">
            Plush
          </Link>
          <Link href="#" className="text-sm font-bold text-gray-600 hover:text-gray-800 transition-colors">
            Figures & Pins
          </Link>
          <Link href="#" className="text-sm font-bold text-gray-600 hover:text-gray-800 transition-colors">
            Stickers
          </Link>
          <Link href="#" className="text-sm font-bold text-gray-600 hover:text-gray-800 transition-colors">
            Home
          </Link>
        </div>
      </div>

      {/* Bottom Tier - Promo Banner */}
      <div className="bg-blue-600 text-white text-center py-2 text-sm font-medium">
        Free on-campus delivery for all orders! Learn more &gt;&gt;
      </div>
    </div>
  );
};

export default Navbar;