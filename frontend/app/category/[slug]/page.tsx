"use client";
import { use } from 'react';
import ShopLayout from '../../components/ShopLayout';

export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <ShopLayout categorySlug={slug} title={slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} />;
}
