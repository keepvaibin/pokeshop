import HomePageClient from './components/HomePageClient';
import { fetchItems, fetchHomepageSections } from './lib/server-fetch';

export default async function HomePage() {
  const [items, newestItems, sections] = await Promise.all([
    fetchItems(''),
    fetchItems('', { sort: 'newest' }),
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
