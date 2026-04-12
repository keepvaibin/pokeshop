"use client";
import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const CORE_MAP: Record<string, string> = {
  'tcg': '/tcg/cards',
  'cards': '/tcg/cards',
  'tcg-cards': '/tcg/cards',
  'sealed': '/tcg/boxes',
  'boxes': '/tcg/boxes',
  'sealed-products': '/tcg/boxes',
  'accessories': '/tcg/accessories',
};

function Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const cat  = searchParams.get('category');
    const sort = searchParams.get('sort');
    if (cat && CORE_MAP[cat]) router.replace(CORE_MAP[cat]);
    else if (cat) router.replace(`/category/${cat}`);
    else if (sort === 'newest') router.replace('/new-releases');
    else router.replace('/tcg');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function ProductsPage() {
  return <Suspense fallback={null}><Redirect /></Suspense>;
}
