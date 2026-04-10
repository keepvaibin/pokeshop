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
    <div className="bg-gray-50 dark:bg-zinc-900 min-h-screen">
      <Navbar />
      {showConfetti && <Confetti width={dimensions.width} height={dimensions.height} recycle={false} numberOfPieces={300} />}

      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm p-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 mb-6">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>

          <h1 className="text-3xl font-black text-gray-900 dark:text-zinc-100 mb-3">Order Confirmed! <PartyPopper className="inline w-8 h-8 text-yellow-500" /></h1>
          <p className="text-gray-600 text-lg mb-8">
            Your reservation has been placed successfully. We&apos;ll reach out on Discord to coordinate pickup.
          </p>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-8 text-left">
            <h3 className="font-semibold text-blue-900 mb-3">What&apos;s Next?</h3>
            <ol className="space-y-2 text-sm text-blue-800">
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600 mt-0.5">1.</span>
                <span>Check Discord for a message from the shop about pickup details.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600 mt-0.5">2.</span>
                <span>Bring your student ID and payment (if applicable) to the pickup.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600 mt-0.5">3.</span>
                <span>If you offered a trade, bring the card in the condition described.</span>
              </li>
            </ol>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/orders"
              className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 text-zinc-50 dark:text-zinc-100 font-bold py-3 px-6 rounded-xl hover:bg-blue-700 transition-colors"
            >
              <Package size={18} /> View My Orders
            </Link>
            <Link
              href="/"
              className="flex-1 inline-flex items-center justify-center gap-2 border border-gray-300 dark:border-zinc-600 text-gray-700 font-semibold py-3 px-6 rounded-xl hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
            >
              Continue Shopping <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
