import Link from 'next/link';
import { fetchSettings } from '@/app/lib/server-fetch';
import NewsletterForm from './NewsletterForm';

type FooterLink = {
  href: string;
  label: string;
  external?: boolean;
};

export default async function Footer() {
  const settings = await fetchSettings();
  const showNewsletter = Boolean(settings?.show_footer_newsletter);
  const publicDiscordInvite = typeof settings?.public_discord_invite === 'string' ? settings.public_discord_invite : '';

  const customerServiceLinks: FooterLink[] = [
    { href: '/delivery-info', label: 'Delivery Info' },
    { href: '/orders', label: 'My Orders' },
    { href: '/cart', label: 'Cart' },
  ];

  const aboutLinks: FooterLink[] = [
    { href: '/tcg', label: 'Shop All' },
    { href: '/new-releases', label: 'New Releases' },
    { href: '/settings', label: 'Settings' },
  ];

  const shoppingLinks: FooterLink[] = [
    { href: '/new-releases', label: 'New Releases' },
    { href: '/tcg/cards', label: 'TCG Cards' },
    { href: '/tcg/accessories', label: 'Accessories' },
  ];

  const connectLinks: FooterLink[] = publicDiscordInvite
    ? [{ href: publicDiscordInvite, label: 'Discord', external: true }]
    : [];

  const renderLinks = (links: FooterLink[]) =>
    links.map((link) =>
      link.external ? (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline"
        >
          {link.label}
        </a>
      ) : (
        <Link
          key={link.label}
          href={link.href}
          className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline"
        >
          {link.label}
        </Link>
      )
    );

  return (
    <footer className="pkc-shell mt-auto print:hidden">
      {showNewsletter && (
        <div className="border-t border-b border-pkmn-border bg-[#f5f5f5] px-4 py-12">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-center">
            <h2 className="text-2xl font-heading font-black text-pkmn-text uppercase">Sign up for updates</h2>
            <p className="max-w-xl text-sm text-pkmn-gray">
              Be the first to know about new drops, restocks, and exclusive deals.
            </p>
            <NewsletterForm />
          </div>
        </div>
      )}

      <div className="bg-pkmn-blue py-12 text-white px-[3.75rem] max-md:px-4 [&_a]:!text-white/70 [&_a:hover]:!text-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">Customer Service</h3>
            {renderLinks(customerServiceLinks)}
          </div>
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">About Us</h3>
            {renderLinks(aboutLinks)}
          </div>
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">Shopping</h3>
            {renderLinks(shoppingLinks)}
          </div>
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">Connect</h3>
            {connectLinks.length > 0 ? renderLinks(connectLinks) : <p className="text-sm text-white/70">Discord invite coming soon</p>}
          </div>
        </div>
        <div className="max-w-7xl mx-auto border-t-[.09375rem] border-white/20 mt-8 pt-6 text-center">
          <p className="text-white/60 text-sm" suppressHydrationWarning>&copy; {new Date().getFullYear()} SCTCG. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
