import HomePageClient from './components/HomePageClient';
import { fetchItems, fetchHomepageSections } from './lib/server-fetch';

export default async function HomePage() {
  const [items, newestItems, sections] = await Promise.all([
    fetchItems('', { home_feed: 'all_products' }),
    fetchItems('', { home_feed: 'new_arrivals' }),
    fetchHomepageSections(),
  ]);

  return (
    <HomePageClient
      initialItems={items}
      initialNewestItems={newestItems}
      initialSections={sections}
    />
  );
}
