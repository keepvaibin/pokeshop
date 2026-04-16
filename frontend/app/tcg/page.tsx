import ShopLayout from '../components/ShopLayout';
import { fetchItems, fetchCategories } from '../lib/server-fetch';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ShopAllPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const [items, categories] = await Promise.all([
    fetchItems('', sp),
    fetchCategories(),
  ]);
  return (
    <ShopLayout
      categorySlug=""
      title="Shop All"
      initialItems={items}
      initialCategories={categories}
    />
  );
}
