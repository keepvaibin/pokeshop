'use client';

import Image from 'next/image';
import Link from 'next/link';

interface PromoTileProps {
  title: string;
  imageUrl: string;
  linkUrl: string;
}

const PromoTile = ({ title, imageUrl, linkUrl }: PromoTileProps) => {
  const src = imageUrl || 'https://placehold.co/600x400/f0f0f0/4d4d4d?text=No+Image';

  return (
    <Link href={linkUrl} className="relative block w-full overflow-hidden cursor-pointer group no-underline text-inherit">
      <Image
        src={src}
        alt={title}
        fill
        className="object-cover w-full h-full group-hover:scale-[1.03] transition-transform duration-500"
        unoptimized={src.includes('placehold.co')}
      />
      <div className="relative w-full aspect-square md:aspect-video" />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <span className="font-heading font-bold text-white text-lg md:text-xl drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]">
          {title}
        </span>
      </div>
    </Link>
  );
};

export default PromoTile;
