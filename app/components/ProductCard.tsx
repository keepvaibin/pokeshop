'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { StorefrontItem } from './storefrontTypes';

interface ProductCardProps {
  item: StorefrontItem;
  onQuickView?: (item: StorefrontItem) => void;
}

const ProductCard = ({ item, onQuickView }: ProductCardProps) => {
  const imageUrl = item.images?.[0]?.url || item.image_path || 'https://placehold.co/600x600/f0f0f0/4d4d4d?text=No+Image';
  const isOutOfStock = item.stock <= 0;

  return (
    <div className="pkc-panel group flex h-full min-h-0 cursor-pointer flex-col overflow-hidden border border-pkmn-border transition-colors duration-[120ms] ease-out hover:border-pkmn-gray-mid hover:bg-[#fafafa]">
      <Link href={`/product/${item.slug}`} className="block no-underline hover:no-underline">
        <div className="relative aspect-square max-h-[180px] sm:max-h-[200px] w-full overflow-hidden border-b border-pkmn-border bg-pkmn-bg p-2">
          <Image
            src={imageUrl}
            alt={item.title}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="h-full w-full object-contain"
            unoptimized={imageUrl.startsWith('http')}
          />
          {isOutOfStock && (
            <div className="absolute inset-x-0 top-1/2 z-[1] -translate-y-1/2 border-y border-pkmn-border bg-white/92 px-4 py-2 text-center">
              <span className="text-sm font-semibold uppercase tracking-[0.08rem] text-pkmn-text">Sold Out</span>
            </div>
          )}
          {item.is_holofoil && (
            <span className="absolute top-2 left-2 border border-pkmn-yellow bg-pkmn-yellow px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06rem] text-black">
              Holofoil
            </span>
          )}
        </div>
      </Link>

      <div className="flex-1 flex flex-col justify-between bg-white px-2.5 py-2.5 text-center sm:px-3 sm:py-3">
        <Link href={`/product/${item.slug}`} className="block no-underline hover:no-underline">
          <div className="space-y-2">
            <h3 className="line-clamp-2 font-heading text-[0.8rem] font-bold leading-4 text-pkmn-text sm:text-[0.95rem] sm:leading-5">
              {item.title}
            </h3>
            {item.rarity && (
              <p className="line-clamp-1 text-[10px] font-semibold uppercase tracking-[0.06rem] text-pkmn-gray-dark sm:text-[11px]">{item.rarity}</p>
            )}
          </div>
        </Link>

        <div className="mt-4 space-y-3">
          <p className="text-[0.9375rem] font-semibold text-pkmn-text sm:text-[1.0625rem]">
            ${Number(item.price).toFixed(2)}
          </p>
          {onQuickView && (
            <button
              type="button"
              onClick={() => onQuickView(item)}
              className="pkc-button-secondary w-full cursor-pointer !px-3 !py-2 !text-[0.6875rem]"
            >
              Quick View
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
