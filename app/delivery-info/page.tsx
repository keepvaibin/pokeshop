import Navbar from '../components/Navbar';
import { MapPin, Clock, Calendar, Truck, MessageCircle } from 'lucide-react';
import Link from 'next/link';

export default function DeliveryInfoPage() {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900 min-h-screen">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-10">
          <h1 className="text-4xl font-black text-gray-900 dark:text-zinc-100 mb-3">
            Pickup &amp; Delivery Info
          </h1>
          <div className="w-16 h-1 bg-gradient-to-r from-yellow-400 to-red-500" />
        </div>

        <div className="space-y-8">
          {/* Scheduled Campus Pickup */}
          <section className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Scheduled Campus Pickup</h2>
            </div>
            <p className="text-gray-600 dark:text-zinc-400 leading-relaxed mb-3">
              On-campus pickup is available based on schedule synchronization. When you check out,
              you can select from available weekly timeslots to reserve a specific day and time to meet
              on the UCSC campus.
            </p>
            <ul className="space-y-2 text-sm text-gray-600 dark:text-zinc-400">
              <li className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                Timeslots are updated weekly — check back if nothing is available.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                You will receive a Discord DM confirming your pickup time once your order is approved.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                Please bring your order confirmation number to the pickup.
              </li>
            </ul>
          </section>

          {/* ASAP Downtown Pickup */}
          <section className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                <Truck className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">ASAP Pickup</h2>
            </div>
            <p className="text-gray-600 dark:text-zinc-400 leading-relaxed mb-3">
              Off-campus and downtown pickups can also be arranged when a scheduled slot isn&apos;t convenient.
              Select the <strong className="text-gray-800 dark:text-zinc-200">&ldquo;ASAP Pickup&rdquo;</strong> option
              at checkout and we will coordinate a meeting time with you via Discord.
            </p>
            <ul className="space-y-2 text-sm text-gray-600 dark:text-zinc-400">
              <li className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                Response time is typically within a few hours.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                Downtown Santa Cruz meetups near Pacific Ave are available.
              </li>
            </ul>
          </section>

          {/* Contact */}
          <section className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Questions?</h2>
            </div>
            <p className="text-gray-600 dark:text-zinc-400 leading-relaxed">
              Have a question about pickup or need to reschedule? Reach out via Discord — your handle
              is linked to your account so we can find you quickly. Make sure your Discord handle is
              up to date in your{' '}
              <Link href="/settings" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                Settings
              </Link>
              .
            </p>
          </section>

          {/* Location note */}
          <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-zinc-500">
            <MapPin className="w-4 h-4 flex-shrink-0" />
            <p>UCSC Pokéshop is a student-run operation serving the UC Santa Cruz community.</p>
          </div>

          <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-zinc-500">
            <Clock className="w-4 h-4 flex-shrink-0" />
            <p>Orders are typically fulfilled within 1–3 business days of placement.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
