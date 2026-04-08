"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useCart } from './contexts/CartContext';
import Navbar from './components/Navbar';

interface Item {
  id: number;
  title: string;
  description: string;
  image_path: string;
  stock: number;
}

export default function Storefront() {
  const [items, setItems] = useState<Item[]>([]);
  const { addToCart } = useCart();

  useEffect(() => {
    axios.get('http://localhost:8000/api/inventory/items/')
      .then(response => setItems(response.data))
      .catch(error => console.error(error));
  }, []);

  return (
    <div>
      <Navbar />
      
      {/* Hero Banner */}
      <div className="w-full h-64 bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 flex items-center justify-center">
        <div className="text-center text-white">
          <h1 className="text-4xl font-bold mb-2">Welcome to UCSC Pokeshop</h1>
          <p className="text-xl">Discover amazing Pokémon merchandise</p>
        </div>
      </div>

      {/* Featured Items Section */}
      <div className="bg-white max-w-7xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Featured Items</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map(item => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="relative">
                <img 
                  src={item.image_path} 
                  alt={item.title} 
                  className={`w-full h-48 object-cover ${item.stock === 0 ? 'grayscale opacity-50' : ''}`} 
                />
                {item.stock === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="bg-gray-800 text-white px-3 py-1 rounded-full text-sm font-medium">
                      Sold Out
                    </span>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="text-lg font-bold text-gray-800 mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm mb-2">{item.description}</p>
                <p className="text-sm text-gray-500 mb-3">Stock: {item.stock}</p>
                {item.stock > 0 && (
                  <button
                    onClick={() => addToCart(item)}
                    className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    Add to Cart
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
