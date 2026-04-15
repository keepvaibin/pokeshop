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
    <Link href={linkUrl} className="block w-full h-full cursor-pointer group no-underline text-inherit">
      <div className="pkc-panel h-full overflow-hidden transition-colors duration-[120ms] ease-out group-hover:border-pkmn-blue">
        <div className="relative w-full aspect-[341/219] md:aspect-[4/3] overflow-hidden border-b border-pkmn-border bg-pkmn-bg">
          <Image
            src={src}
            alt={title}
            fill
            sizes="(max-width: 1024px) 50vw, 25vw"
            className="object-cover w-full h-full transition-transform duration-[220ms] ease-out group-hover:scale-[1.03]"
            unoptimized
          />
        </div>
        <p className="px-3 py-3 text-center font-heading text-sm font-bold uppercase tracking-[0.06rem] text-pkmn-text line-clamp-2 min-h-[2.75rem] flex items-center justify-center">
          {title}
        </p>
      </div>
    </Link>
  );
};

export default PromoTile;
