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
    const clean = DOMPurify.sanitize(html ?? '', {
      ADD_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col'],
      ADD_ATTR: ['colspan', 'rowspan', 'scope'],
    });
    // Replace non-breaking spaces (&nbsp; / U+00A0) with regular spaces so text
    // wraps normally at word boundaries instead of running together as one
    // unbreakable block (common artifact when pasting from Word/PDF into Quill).
    return clean.replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ');
  }, [html]);

  return (
    <div
      className={className}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
