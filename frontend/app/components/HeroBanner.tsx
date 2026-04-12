'use client';

import Image from 'next/image';
import Link from 'next/link';

interface HeroBannerProps {
  title: string;
  subtitle?: string;
  imageUrl: string;
  linkUrl: string;
}

const HeroBanner = ({ title, subtitle, imageUrl, linkUrl }: HeroBannerProps) => {
  const src = imageUrl || '/hero-banner.jpg';

  return (
    <Link href={linkUrl} className="relative block w-full overflow-hidden text-white no-underline">
      <Image
        src={src}
        alt={title}
        fill
        sizes="100vw"
        className="object-cover w-full h-full"
        priority
        unoptimized
      />
      <div className="relative w-full h-[300px] md:h-[400px] lg:h-[500px]" />
      <div className="absolute bottom-[1.875rem] left-1/2 -translate-x-1/2 text-center max-w-[80%] w-full px-[min(6.697vw,1.5rem)]">
        <h1 className="font-heading text-[1.25rem] sm:text-[2.25rem] lg:text-[3rem] font-bold leading-[1.1] mb-[.625rem]">{title}</h1>
        {subtitle && <p className="text-base leading-[1.4] mb-[.625rem]">{subtitle}</p>}
        <span
          className="inline-block bg-pkmn-yellow text-black font-heading font-bold uppercase text-sm lg:text-base
            px-[.9375rem] py-[.9375rem] cursor-pointer mx-[.625rem]
            transition-[background-color] duration-[120ms] ease-out hover:bg-pkmn-yellow-dark"
        >
          Shop Now
        </span>
      </div>
    </Link>
  );
};

export default HeroBanner;
