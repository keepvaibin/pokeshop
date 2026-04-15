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
        <h2 className="text-2xl font-heading font-black uppercase">
          <span className="text-pkmn-text">{title}</span>
        </h2>
      </div>
      <div className="group relative">
        <button
          type="button"
          onClick={() => scroll('left')}
          aria-label={`Scroll ${title} left`}
          className="absolute -left-12 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 md:flex items-center justify-center border border-pkmn-border bg-white text-pkmn-text opacity-0 transition-colors duration-[120ms] ease-out group-hover:opacity-100 hover:bg-pkmn-blue hover:text-white"
        >
          <ChevronLeft className="w-5 h-5 text-current" />
        </button>
        <div ref={containerRef} className="thin-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 sm:gap-6">
          {items.map((item) => (
            <div key={item.id} className="min-w-[140px] snap-start flex-shrink-0 sm:min-w-[180px] md:min-w-[200px] flex flex-col h-full">
              <ProductCard item={item} onQuickView={onQuickView} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => scroll('right')}
          aria-label={`Scroll ${title} right`}
          className="absolute -right-12 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 md:flex items-center justify-center border border-pkmn-border bg-white text-pkmn-text opacity-0 transition-colors duration-[120ms] ease-out group-hover:opacity-100 hover:bg-pkmn-blue hover:text-white"
        >
          <ChevronRight className="w-5 h-5 text-current" />
        </button>
      </div>
    </div>
  );
};

export default ProductCarousel;
