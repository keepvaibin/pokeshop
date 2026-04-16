import ShopLayout from '../../components/ShopLayout';
import { fetchItems, fetchCategories } from '../../lib/server-fetch';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BoxesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const [items, categories] = await Promise.all([
    fetchItems('boxes', sp),
    fetchCategories(),
  ]);
  return (
    <ShopLayout
      categorySlug="boxes"
      title="Boxes"
      initialItems={items}
      initialCategories={categories}
    />
  );
}
