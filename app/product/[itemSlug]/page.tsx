"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import { useCart } from '../../contexts/CartContext';
import Navbar from '../../components/Navbar';
import { Star, ShoppingCart, AlertCircle } from 'lucide-react';

interface ItemImage {
  id: number;
  image_path: string;
}

interface Item {
  id: number;
  title: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  images: ItemImage[];
}

export default function ProductPage() {
  const { itemSlug } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string>('');
  const { addToCart } = useCart();

  useEffect(() => {
    if (itemSlug) {
      axios.get(`http://localhost:8000/api/inventory/items/?slug=${itemSlug}`)
        .then(response => {
          const foundItem = response.data.find((i: Item) => i.slug === itemSlug);
          if (foundItem) {
            setItem(foundItem);
            setSelectedImage(foundItem.images[0]?.image_path || '');
          }
        })
        .catch(error => console.error(error))
        .finally(() => setLoading(false));
    }
  }, [itemSlug]);

  const handleAddToCart = () => {
    if (item) {
      addToCart({
        id: item.id,
        title: item.title,
        price: item.price,
        quantity: 1,
        image_path: selectedImage,
        description: item.description,
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-600 text-lg">Loading product...</p>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-800">Product Not Found</h1>
            <p className="text-gray-600">The product you're looking for doesn't exist.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Image Gallery */}
          <div className="space-y-4">
            <div className="aspect-square bg-white rounded-2xl overflow-hidden shadow-lg">
              <img
                src={selectedImage}
                alt={item.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex space-x-2 overflow-x-auto">
              {item.images.map((image) => (
                <button
                  key={image.id}
                  onClick={() => setSelectedImage(image.image_path)}
                  className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 ${
                    selectedImage === image.image_path ? 'border-blue-500' : 'border-gray-200'
                  }`}
                >
                  <img
                    src={image.image_path}
                    alt={`${item.title} ${image.id}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Product Details */}
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{item.title}</h1>
              <p className="text-2xl font-semibold text-blue-600 mt-2">${item.price.toFixed(2)}</p>
              <div className="flex items-center mt-2">
                <div className="flex items-center">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <span className="ml-2 text-sm text-gray-600">(4.8) • {item.stock} in stock</span>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Description</h2>
              <p className="text-gray-700 leading-relaxed">{item.description}</p>
            </div>

            <button
              onClick={handleAddToCart}
              disabled={item.stock === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-4 px-6 rounded-2xl transition-colors flex items-center justify-center gap-2"
            >
              <ShoppingCart className="w-5 h-5" />
              {item.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
