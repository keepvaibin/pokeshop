"use client";

import { useState, type ImgHTMLAttributes } from 'react';
import { ImageIcon } from 'lucide-react';

interface FallbackImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'> {
  fallbackSize?: number;
  fallbackClassName?: string;
}

export default function FallbackImage({ fallbackSize = 48, fallbackClassName, ...imgProps }: FallbackImageProps) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div className={fallbackClassName}>
        <ImageIcon size={fallbackSize} className="text-gray-400" />
      </div>
    );
  }

  return <img {...imgProps} onError={() => setErrored(true)} />;
}
