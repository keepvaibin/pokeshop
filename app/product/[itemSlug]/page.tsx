import type { Metadata } from 'next';
import ProductPageClient from './ProductPageClient';
import { fetchItem } from '../../lib/server-fetch';

interface PageProps {
  params: Promise<{ itemSlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { itemSlug } = await params;
  const item = await fetchItem(itemSlug);
  if (!item) return { title: 'Product Not Found | SCTCG' };
  return {
    title: `${item.title} | SCTCG`,
    description: item.short_description || item.description || '',
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { itemSlug } = await params;
  const item = await fetchItem(itemSlug);
  return <ProductPageClient initialItem={item} slug={itemSlug} />;
}
