'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ProductCard from './ProductCard';
import type { StorefrontItem } from './storefrontTypes';

interface ProductCarouselProps {
  title: string;
  items: StorefrontItem[];
  onQuickView?: (item: StorefrontItem) => void;
}

const ProductCarousel = ({ title, items, onQuickView }: ProductCarouselProps) => {
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
      <div className="mb-6 border-b border-pkmn-border pb-3">
        <h2 className="text-2xl font-heading font-black text-pkmn-text uppercase">{title}</h2>
      </div>
      <div className="relative group">
        <button
          type="button"
          onClick={() => scroll('left')}
          className="hidden md:flex absolute left-0 top-1/2 z-10 h-10 w-10 -translate-x-2 -translate-y-1/2 items-center justify-center border border-pkmn-border bg-white text-pkmn-text transition-colors duration-[120ms] ease-out opacity-0 group-hover:opacity-100 hover:bg-pkmn-blue hover:text-white"
        >
          <ChevronLeft className="w-5 h-5 text-current" />
        </button>
        <div ref={containerRef} className="thin-scrollbar flex overflow-x-auto snap-x snap-mandatory space-x-5 pb-4">
          {items.map((item) => (
            <div key={item.id} className="min-w-[220px] md:min-w-[250px] snap-start flex-shrink-0">
              <ProductCard item={item} onQuickView={onQuickView} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => scroll('right')}
          className="hidden md:flex absolute right-0 top-1/2 z-10 h-10 w-10 translate-x-2 -translate-y-1/2 items-center justify-center border border-pkmn-border bg-white text-pkmn-text transition-colors duration-[120ms] ease-out opacity-0 group-hover:opacity-100 hover:bg-pkmn-blue hover:text-white"
        >
          <ChevronRight className="w-5 h-5 text-current" />
        </button>
      </div>
    </div>
  );
};

export default ProductCarousel;
