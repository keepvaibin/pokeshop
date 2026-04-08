"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { useCart } from './contexts/CartContext';
import Navbar from './components/Navbar';
import { Star, Eye, ShoppingCart, X } from 'lucide-react';

interface Item {
  id: number;
  title: string;
  slug: string;
  description: string;
  images: { id: number; image_path: string }[];
  stock: number;
  price: number;
}

export default function Storefront() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickViewItem, setQuickViewItem] = useState<Item | null>(null);
  const { addToCart } = useCart();

export default function Storefront() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const { addToCart } = useCart();

  useEffect(() => {
    axios.get('http://localhost:8000/api/inventory/items/')
      .then(response => setItems(response.data))
      .catch(error => console.error(error))
      .finally(() => setLoading(false));
  }, []);

  const handleQuickView = (item: Item) => {
    setQuickViewItem(item);
  };

  const handleAddToCart = (item: Item) => {
    addToCart({
      id: item.id,
      title: item.title,
      price: item.price,
      quantity: 1,
      image_path: item.images[0]?.image_path || '',
      description: item.description,
    });
  };

  return (
    <div className="bg-slate-50 min-h-screen">
      <Navbar />
      
      {/* Hero Banner - Enhanced */}
      <div className="w-full h-80 bg-gradient-to-r from-yellow-400 via-red-500 to-blue-600 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 text-6xl">⚡</div>
          <div className="absolute bottom-10 right-10 text-6xl">🔴</div>
        </div>
        <div className="text-center text-white relative z-10">
          <h1 className="text-5xl font-black mb-3 drop-shadow-lg">Welcome to UCSC Pokéshop</h1>
          <p className="text-2xl font-semibold drop-shadow-md">Gotta catch 'em all! Premium Pokémon gear for Slugs</p>
        </div>
      </div>

      {/* Trending/Featured Section */}
      <div className="bg-white border-b-4 border-yellow-400 py-4">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center space-x-2 text-red-600 font-bold text-lg">
            <span className="text-2xl">🔥</span>
            <span>Trending Now</span>
          </div>
          <p className="text-gray-600 text-sm mt-1">Limited availability • Must-have items</p>
        </div>
      </div>

      {/* Featured Items Section */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h2 className="text-4xl font-black text-gray-900 mb-2">Featured Items</h2>
          <div className="w-16 h-1 bg-gradient-to-r from-yellow-400 to-red-500"></div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500 text-lg">Loading items...</div>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center">
            <div className="text-6xl mb-4">🐢</div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">Coming Soon!</h3>
            <p className="text-gray-600 text-lg mb-2">Our Squirtles are still gathering stock...</p>
            <p className="text-gray-500">Check back soon for amazing Pokémon merchandise!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {items.map(item => (
              <div
                key={item.id}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-xl hover:scale-105 transition-all duration-300 flex flex-col"
              >
                <div className="relative bg-gray-100">
                  <Link href={`/product/${item.slug}`}>
                    <img
                      src={item.images[0]?.image_path || '/placeholder.png'}
                      alt={item.title}
                      className={`w-full h-48 object-cover cursor-pointer ${item.stock === 0 ? 'grayscale opacity-60' : ''}`}
                    />
                  </Link>
                  {item.stock === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40">
                      <span className="bg-red-600 text-white px-4 py-2 rounded-full text-sm font-bold">
                        Sold Out
                      </span>
                    </div>
                  )}
                  {item.stock > 0 && item.stock <= 3 && (
                    <div className="absolute top-2 right-2 bg-orange-500 text-white px-3 py-1 rounded-full text-xs font-bold">
                      Only {item.stock} left!
                    </div>
                  )}
                </div>
                <div className="p-4 flex-grow flex flex-col">
                  <h3 className="text-lg font-bold text-gray-900 mb-2 line-clamp-2">{item.title}</h3>
                  <p className="text-gray-600 text-sm mb-3 flex-grow">{item.description}</p>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-500">Stock: {item.stock}</span>
                    <div className="flex text-yellow-400">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={14} fill="currentColor" />
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleQuickView(item)}
                      className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                      <Eye size={16} />
                      Quick View
                    </button>
                    {item.stock > 0 && (
                      <button
                        onClick={() => handleAddToCart(item)}
                        className="flex-1 bg-gradient-to-r from-yellow-400 to-red-500 text-white font-bold py-2 px-3 rounded-lg hover:from-yellow-500 hover:to-red-600 active:scale-95 transition-all duration-200 flex items-center justify-center gap-1"
                      >
                        <ShoppingCart size={16} />
                        Add
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Section */}
      <div className="bg-gray-900 text-white py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-gray-400">© 2026 UCSC Pokéshop. Pokémon is a trademark of Nintendo/Game Freak.</p>
        </div>
      </div>

      {/* Quick View Modal */}
      {quickViewItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold text-gray-900">{quickViewItem.title}</h2>
                <button
                  onClick={() => setQuickViewItem(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <img
                    src={quickViewItem.images[0]?.image_path || '/placeholder.png'}
                    alt={quickViewItem.title}
                    className="w-full h-64 object-cover rounded-lg"
                  />
                </div>
                <div className="space-y-4">
                  <p className="text-gray-700">{quickViewItem.description}</p>
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold text-blue-600">${quickViewItem.price.toFixed(2)}</span>
                    <span className="text-sm text-gray-600">Stock: {quickViewItem.stock}</span>
                  </div>
                  <button
                    onClick={() => {
                      handleAddToCart(quickViewItem);
                      setQuickViewItem(null);
                    }}
                    disabled={quickViewItem.stock === 0}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                  >
                    {quickViewItem.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
