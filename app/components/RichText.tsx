"use client";

import { useMemo } from 'react';
import DOMPurify from 'dompurify';

interface RichTextProps {
  html: string;
  className?: string;
}

export default function RichText({ html, className = '' }: RichTextProps) {
  const sanitized = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return DOMPurify.sanitize(html ?? '', {
      ADD_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col'],
      ADD_ATTR: ['colspan', 'rowspan', 'scope'],
    });
  }, [html]);

  return (
    <div
      className={className}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
