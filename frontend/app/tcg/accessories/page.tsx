import ShopLayout from '../../components/ShopLayout';
import { fetchItems, fetchCategories } from '../../lib/server-fetch';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AccessoriesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const [items, categories] = await Promise.all([
    fetchItems('accessories', sp),
    fetchCategories(),
  ]);
  return (
    <ShopLayout
      categorySlug="accessories"
      title="Accessories"
      initialItems={items}
      initialCategories={categories}
    />
  );
}
