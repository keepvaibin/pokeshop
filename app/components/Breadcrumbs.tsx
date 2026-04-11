'use client';

import Link from 'next/link';

interface BreadcrumbItem {
  label: string;
  url: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

const Breadcrumbs = ({ items }: BreadcrumbsProps) => {
  return (
    <nav className="flex items-center flex-wrap py-4 font-heading text-[.875rem] leading-[1.4] uppercase">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={item.url} className="flex items-center">
            {isLast ? (
              <span className="font-bold text-pkmn-text">{item.label}</span>
            ) : (
              <>
                <Link
                  href={item.url}
                  className="font-bold text-pkmn-gray-dark no-underline hover:text-pkmn-blue hover:no-underline transition-colors"
                >
                  {item.label}
                </Link>
                <span className="mx-[.4375rem] text-pkmn-gray-dark">/</span>
              </>
            )}
          </span>
        );
      })}
    </nav>
  );
};

export default Breadcrumbs;
