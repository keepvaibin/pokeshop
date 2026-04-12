'use client';

import Image from 'next/image';
import Link from 'next/link';

interface PromoTileProps {
  title: string;
  imageUrl: string;
  linkUrl: string;
}

const PromoTile = ({ title, imageUrl, linkUrl }: PromoTileProps) => {
  const src = imageUrl || '/promo-placeholder.jpg';

  return (
    <Link href={linkUrl} className="block w-full cursor-pointer group no-underline text-inherit">
      {/* Image area */}
      <div className="relative w-full aspect-[341/219] md:aspect-[4/3] overflow-hidden rounded-[4px]">
        <Image
          src={src}
          alt={title}
          fill
          sizes="(max-width: 1024px) 50vw, 25vw"
          className="object-cover w-full h-full group-hover:scale-110 transition-transform duration-[400ms] [transition-timing-function:cubic-bezier(.2,.9,.2,1)]"
          unoptimized
        />
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-[background-color] duration-[220ms] ease-out" />
      </div>
      {/* Label below image */}
      <p className="font-heading font-bold text-pkmn-text text-base md:text-lg mt-2 text-center">
        {title}
      </p>
    </Link>
  );
};

export default PromoTile;
