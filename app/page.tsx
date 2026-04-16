import HomePageClient from './components/HomePageClient';
import { fetchItems, fetchHomepageSections, fetchSettings } from './lib/server-fetch';

export default async function HomePage() {
  const [items, newestItems, sections, settings] = await Promise.all([
    fetchItems(''),
    fetchItems('', { sort: 'newest' }),
    fetchHomepageSections(),
    fetchSettings(),
  ]);

  return (
    <HomePageClient
      initialItems={items}
      initialNewestItems={newestItems}
      initialSections={sections}
      initialAnnouncement={settings?.store_announcement ?? ''}
    />
  );
}
