"use client";

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import { CheckCircle, Package, ArrowRight, PartyPopper } from 'lucide-react';

const Confetti = dynamic(() => import('react-confetti'), { ssr: false });

export default function CheckoutSuccess() {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDimensions({ width: window.innerWidth, height: window.innerHeight });
    const timer = setTimeout(() => setShowConfetti(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      <Navbar />
      {showConfetti && <Confetti width={dimensions.width} height={dimensions.height} recycle={false} numberOfPieces={300} />}

      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="pkc-panel p-10">
          <div className="mb-6 inline-flex h-20 w-20 items-center justify-center border border-green-600/20 bg-green-500/15">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>

          <h1 className="text-3xl font-heading font-black text-pkmn-text mb-3 uppercase">Order Confirmed! <PartyPopper className="inline w-8 h-8 text-pkmn-yellow" /></h1>
          <p className="text-pkmn-gray text-lg mb-8">
            Your reservation has been placed successfully. We&apos;ll reach out on Discord to coordinate pickup.
          </p>

          <div className="bg-pkmn-blue/10 border border-pkmn-blue/20 p-5 mb-8 text-left">
            <h3 className="font-semibold text-pkmn-blue-dark mb-3">What&apos;s Next?</h3>
            <ol className="space-y-2 text-sm text-pkmn-blue">
              <li className="flex items-start gap-2">
                <span className="font-bold text-pkmn-blue mt-0.5">1.</span>
                <span>Check Discord for a message from the shop about pickup details.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-pkmn-blue mt-0.5">2.</span>
                <span>Bring your student ID and payment (if applicable) to the pickup.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-pkmn-blue mt-0.5">3.</span>
                <span>If you offered a trade, bring the card in the condition described.</span>
              </li>
            </ol>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/orders"
              className="pkc-button-primary flex-1 no-underline hover:no-underline"
            >
              <Package size={18} /> View My Orders
            </Link>
            <Link
              href="/"
              className="pkc-button-secondary flex-1 no-underline hover:no-underline"
            >
              Continue Shopping <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
