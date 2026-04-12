'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const Footer = () => {
  const [showNewsletter, setShowNewsletter] = useState(false);

  useEffect(() => {
    let isMounted = true;

    fetch(`${API}/api/inventory/settings/`)
      .then((response) => response.json())
      .then((data) => {
        if (isMounted) {
          setShowNewsletter(Boolean(data?.show_footer_newsletter));
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <footer className="pkc-shell mt-auto">
      {/* Newsletter Section */}
      {showNewsletter && (
        <div className="border-t border-b border-pkmn-border bg-[#f5f5f5] px-4 py-12">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-center">
            <h2 className="text-2xl font-heading font-black text-pkmn-text uppercase">Sign up for updates</h2>
            <p className="max-w-xl text-sm text-pkmn-gray">
              Be the first to know about new drops, restocks, and exclusive deals.
            </p>
            <form className="flex w-full max-w-xl flex-col gap-3 sm:flex-row" onSubmit={(e) => e.preventDefault()}>
              <input
                type="email"
                placeholder="Enter your email"
                className="pkc-input flex-1"
              />
              <button type="submit" className="pkc-button-accent sm:min-w-[10rem]">
                Subscribe
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Links & Legal */}
      <div className="bg-pkmn-blue py-12 text-white px-[3.75rem] max-md:px-4 [&_a]:!text-white/70 [&_a:hover]:!text-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">Customer Service</h3>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Contact Us</Link>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">FAQ</Link>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Shipping Info</Link>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Returns</Link>
          </div>
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">About Us</h3>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Our Story</Link>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">UCSC Campus</Link>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Trade Policy</Link>
          </div>
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">Shopping</h3>
            <Link href="/new-releases" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">New Releases</Link>
            <Link href="/tcg/cards" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">TCG Cards</Link>
            <Link href="/tcg/accessories" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Accessories</Link>
          </div>
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">Connect</h3>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Discord</Link>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Instagram</Link>
          </div>
        </div>
        <div className="max-w-7xl mx-auto border-t-[.09375rem] border-white/20 mt-8 pt-6 text-center">
          <p className="text-white/60 text-sm">&copy; {new Date().getFullYear()} SCTCG. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
