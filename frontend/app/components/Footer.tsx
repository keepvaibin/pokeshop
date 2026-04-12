'use client';

import Link from 'next/link';

const Footer = () => {
  return (
    <footer className="mt-auto">
      {/* Newsletter Section */}
      <div className="bg-pkmn-bg py-12 px-4 flex flex-col items-center justify-center border-t border-pkmn-border">
        <h2 className="text-2xl font-heading font-black text-pkmn-text mb-4 uppercase">Sign up for updates</h2>
        <p className="text-pkmn-gray text-sm mb-6 text-center max-w-md">
          Be the first to know about new drops, restocks, and exclusive deals.
        </p>
        <form className="flex flex-col sm:flex-row w-full max-w-md" onSubmit={(e) => e.preventDefault()}>
          <input
            type="email"
            placeholder="Enter your email"
            className="flex-1 bg-white border border-pkmn-border text-pkmn-text p-3 sm:border-r-0 focus:outline-none focus:border-pkmn-blue"
          />
          <button
            type="submit"
            className="bg-pkmn-yellow text-black font-heading font-bold px-6 py-3 hover:bg-pkmn-yellow-dark transition-colors duration-[120ms] ease-out uppercase tracking-[0.0625rem] text-sm"
          >
            Subscribe
          </button>
        </form>
      </div>

      {/* Links & Legal */}
      <div className="bg-pkmn-blue text-white py-12 px-[3.75rem] max-md:px-4">
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
            <Link href="/products" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">New Releases</Link>
            <Link href="/products" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">TCG Cards</Link>
            <Link href="/products" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Accessories</Link>
          </div>
          <div>
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-4">Connect</h3>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Discord</Link>
            <Link href="#" className="text-sm text-white/70 hover:text-white mb-2 block transition-colors duration-[120ms] ease-out no-underline hover:no-underline">Instagram</Link>
          </div>
        </div>
        <div className="max-w-7xl mx-auto border-t-[.09375rem] border-white/20 mt-8 pt-6 text-center">
          <p className="text-white/60 text-sm">&copy; {new Date().getFullYear()} UCSC Pok&eacute;shop. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
