import ShopLayout from '../../components/ShopLayout';
import { fetchItems, fetchCategories } from '../../lib/server-fetch';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const [items, categories] = await Promise.all([
    fetchItems(slug, sp),
    fetchCategories(),
  ]);
  return (
    <ShopLayout
      categorySlug={slug}
      title={slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
      initialItems={items}
      initialCategories={categories}
    />
  );
}
