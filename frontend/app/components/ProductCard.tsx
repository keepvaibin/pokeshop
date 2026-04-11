'use client';

import Image from 'next/image';
import Link from 'next/link';

interface ProductCardProps {
  item: {
    id: number;
    title: string;
    slug: string;
    price: string;
    image_path: string;
    images: { url: string }[];
    stock: number;
    is_holofoil?: boolean;
    rarity?: string;
  };
}

const ProductCard = ({ item }: ProductCardProps) => {
  const imageUrl = item.images?.[0]?.url || item.image_path || 'https://placehold.co/600x600/f0f0f0/4d4d4d?text=No+Image';
  const isOutOfStock = item.stock <= 0;

  return (
    <Link href={`/product/${item.slug}`} className="block h-full">
      <div className="bg-white flex flex-col h-full transition-[filter] duration-300 ease-in-out cursor-pointer group">
        <div className="relative w-full aspect-square overflow-hidden rounded-[4px] bg-pkmn-bg">
          <Image
            src={imageUrl}
            alt={item.title}
            fill
            className="object-cover w-full h-full"
            unoptimized={imageUrl.includes('placehold.co')}
          />
          {isOutOfStock && (
            <div className="absolute inset-0 bg-black/75 flex items-center justify-center z-[1]">
              <span className="text-white font-semibold text-sm">Sold Out</span>
            </div>
          )}
          {item.is_holofoil && (
            <span className="absolute top-2 left-2 bg-pkmn-yellow text-black text-[10px] font-bold px-2 py-0.5">
              Holofoil
            </span>
          )}
        </div>
        <div className="pt-3">
          <h3 className="font-heading font-bold text-pkmn-text text-sm lg:text-[1.125rem] leading-tight line-clamp-2 min-h-[2.5rem] lg:min-h-[3.25rem] mb-1">
            {item.title}
          </h3>
          {item.rarity && (
            <p className="text-xs text-pkmn-gray-dark mb-1">{item.rarity}</p>
          )}
          <p className="text-pkmn-text text-sm lg:text-[1.125rem] mt-auto mb-3">
            ${parseFloat(item.price).toFixed(2)}
          </p>
        </div>
      </div>
    </Link>
  );
};

export default ProductCard;
