'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ProductCard from './ProductCard';

interface CarouselItem {
  id: number;
  title: string;
  slug: string;
  price: string;
  image_path: string;
  images: { url: string }[];
  stock: number;
  is_holofoil?: boolean;
  rarity?: string;
}

interface ProductCarouselProps {
  title: string;
  items: CarouselItem[];
}

const ProductCarousel = ({ title, items }: ProductCarouselProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!containerRef.current) return;
    const amount = 280;
    containerRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="relative">
      <h2 className="text-2xl font-heading font-black text-pkmn-text uppercase mb-6">{title}</h2>
      <div className="relative group">
        <button
          onClick={() => scroll('left')}
          className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 bg-white shadow-pkmn-card w-10 h-10 items-center justify-center hover:shadow-pkmn-hover transition-shadow duration-[120ms] ease-out opacity-0 group-hover:opacity-100"
        >
          <ChevronLeft className="w-5 h-5 text-pkmn-text" />
        </button>
        <div ref={containerRef} className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar space-x-4 pb-4">
          {items.map((item) => (
            <div key={item.id} className="min-w-[220px] md:min-w-[250px] snap-start flex-shrink-0">
              <ProductCard item={item} />
            </div>
          ))}
        </div>
        <button
          onClick={() => scroll('right')}
          className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 bg-white shadow-pkmn-card w-10 h-10 items-center justify-center hover:shadow-pkmn-hover transition-shadow duration-[120ms] ease-out opacity-0 group-hover:opacity-100"
        >
          <ChevronRight className="w-5 h-5 text-pkmn-text" />
        </button>
      </div>
    </div>
  );
};

export default ProductCarousel;
