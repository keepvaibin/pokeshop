import ShopLayout from '../components/ShopLayout';
import { fetchItems, fetchCategories } from '../lib/server-fetch';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewReleasesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const [items, categories] = await Promise.all([
    fetchItems('', sp, true),
    fetchCategories(),
  ]);
  return (
    <ShopLayout
      categorySlug=""
      title="New Releases"
      lockSort
      initialItems={items}
      initialCategories={categories}
    />
  );
}
