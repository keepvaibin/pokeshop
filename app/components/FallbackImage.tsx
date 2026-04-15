"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, type ImgHTMLAttributes } from 'react';
import { ImageIcon } from 'lucide-react';

interface FallbackImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'> {
  fallbackSize?: number;
  fallbackClassName?: string;
}

export default function FallbackImage({ fallbackSize = 48, fallbackClassName, ...imgProps }: FallbackImageProps) {
  const [errored, setErrored] = useState(false);

  if (errored || !imgProps.src) {
    return (
      <div className={fallbackClassName}>
        <ImageIcon size={fallbackSize} className="text-pkmn-gray-dark" />
      </div>
    );
  }

  return <img {...imgProps} alt={imgProps.alt ?? ''} onError={() => setErrored(true)} />;
}
