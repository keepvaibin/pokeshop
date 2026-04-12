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
    <Link href={linkUrl} className="block w-full border-b border-pkmn-border bg-white no-underline hover:no-underline">
      <div className="relative h-[260px] w-full md:h-[400px] lg:h-[460px]">
        <Image
          src={src}
          alt={title}
          fill
          sizes="100vw"
          className="object-cover w-full h-full"
          priority
          unoptimized
        />
        <div className="absolute inset-0 bg-black/20" />
      </div>
      <div className="border-t-4 border-pkmn-yellow bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-3xl">
            <h1 className="font-heading text-[1.4rem] font-black uppercase leading-tight text-pkmn-text md:text-[2.4rem]">{title}</h1>
            {subtitle && <p className="mt-2 max-w-2xl text-sm leading-6 text-pkmn-gray md:text-base">{subtitle}</p>}
          </div>
          <span className="pkc-button-accent min-w-[11rem] text-center">Shop Now</span>
        </div>
      </div>
    </Link>
  );
};

export default HeroBanner;
