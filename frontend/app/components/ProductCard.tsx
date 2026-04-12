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
    <div className="pkc-panel flex h-full cursor-pointer flex-col border border-pkmn-border transition-colors duration-[120ms] ease-out group hover:border-pkmn-gray-mid hover:bg-[#fafafa]">
      <Link href={`/product/${item.slug}`} className="block h-full no-underline hover:no-underline flex-1">
        <div className="relative w-full aspect-square overflow-hidden border-b border-pkmn-border bg-pkmn-bg">
          <Image
            src={imageUrl}
            alt={item.title}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain w-full h-full p-4"
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
        <div className="flex flex-1 flex-col items-center px-4 py-4 text-center">
          <h3 className="font-heading text-[0.95rem] font-bold leading-5 text-pkmn-text line-clamp-2 min-h-[2.5rem] mb-1">
            {item.title}
          </h3>
          {item.rarity && (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06rem] text-pkmn-gray-dark">{item.rarity}</p>
          )}
          <p className="mt-auto text-[1.125rem] font-semibold text-pkmn-text">
            ${Number(item.price).toFixed(2)}
          </p>
        </div>
      </Link>

      {onQuickView && (
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => onQuickView(item)}
            className="pkc-button-secondary w-full !px-3 !py-2 !text-[0.6875rem] md:opacity-0 md:group-hover:opacity-100"
          >
            Quick View
          </button>
        </div>
      )}
    </div>
  );
};

export default ProductCard;
