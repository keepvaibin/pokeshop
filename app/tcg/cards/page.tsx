import ShopLayout from '../../components/ShopLayout';
import { fetchItems, fetchCategories } from '../../lib/server-fetch';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CardsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const [items, categories] = await Promise.all([
    fetchItems('cards', sp),
    fetchCategories(),
  ]);
  return (
    <ShopLayout
      categorySlug="cards"
      title="TCG Cards"
      initialItems={items}
      initialCategories={categories}
    />
  );
}
