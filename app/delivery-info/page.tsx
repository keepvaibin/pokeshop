"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  MapPin,
  MessageCircle,
  PackageCheck,
  ShoppingBag,
} from 'lucide-react';
import Navbar from '../components/Navbar';

type DeliveryMethod = 'scheduled' | 'asap';
type PaymentMethod = 'venmo' | 'zelle' | 'paypal' | 'cash' | 'cash_plus_trade';

const scheduledDays = [
  {
    id: 'tue',
    label: 'Tuesday',
    dateLabel: 'Apr 16',
    slots: [
      { id: 'tue-1', time: '2:00 PM - 3:00 PM', location: 'Crown College Courtyard', spotsLeft: 3 },
      { id: 'tue-2', time: '3:15 PM - 4:00 PM', location: 'McHenry Library Steps', spotsLeft: 1 },
    ],
  },
  {
    id: 'thu',
    label: 'Thursday',
    dateLabel: 'Apr 18',
    slots: [
      { id: 'thu-1', time: '12:30 PM - 1:15 PM', location: 'Quarry Plaza', spotsLeft: 4 },
      { id: 'thu-2', time: '4:30 PM - 5:30 PM', location: 'Porter Koi Pond', spotsLeft: 2 },
    ],
  },
  {
    id: 'sat',
    label: 'Saturday',
    dateLabel: 'Apr 20',
    slots: [
      { id: 'sat-1', time: '11:00 AM - 12:00 PM', location: 'Science Hill Bus Stop', spotsLeft: 5 },
      { id: 'sat-2', time: '1:00 PM - 2:00 PM', location: 'Stevenson Event Lawn', spotsLeft: 2 },
    ],
  },
];

const paymentOptions: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'venmo', label: 'Venmo' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'cash', label: 'Cash' },
  { value: 'cash_plus_trade', label: 'Trade-In' },
];

const afterCheckout = [
  {
    title: 'We hold the item for you',
    body: 'Once a real order is placed, the item is set aside while pickup is confirmed.',
    icon: ShoppingBag,
  },
  {
    title: 'Campus pickup keeps your slot',
    body: 'If you choose a campus window, that day, time, and meetup spot stay attached to the order.',
    icon: CalendarDays,
  },
  {
    title: 'ASAP pickup moves to messaging',
    body: 'If you choose ASAP, we skip the campus slot picker and follow up about the quickest downtown meetup.',
    icon: MapPin,
  },
  {
    title: 'Payment stays the same',
    body: 'Venmo, Zelle, PayPal, Cash, and Trade-In show up here the same way they do in the real checkout.',
    icon: CreditCard,
  },
];

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.42, ease: 'easeOut' as const },
};

export default function DeliveryInfoPage() {
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('scheduled');
  const [selectedDay, setSelectedDay] = useState(scheduledDays[0].id);
  const [selectedSlotId, setSelectedSlotId] = useState(scheduledDays[0].slots[0].id);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('venmo');
  const [previewConfirmed, setPreviewConfirmed] = useState(false);

  const activeDay = useMemo(
    () => scheduledDays.find((day) => day.id === selectedDay) ?? scheduledDays[0],
    [selectedDay],
  );

  const selectedSlot = useMemo(
    () => activeDay.slots.find((slot) => slot.id === selectedSlotId) ?? activeDay.slots[0],
    [activeDay, selectedSlotId],
  );

  const selectedPaymentLabel = paymentOptions.find((option) => option.value === paymentMethod)?.label ?? 'Venmo';
  const canPreviewConfirm = deliveryMethod === 'asap' || Boolean(selectedSlot);

  const confirmationFeed = deliveryMethod === 'scheduled'
    ? [
        'Example outcome: your order is in and the items are on hold.',
        `${activeDay.label} at ${selectedSlot.time} is the pickup window attached to it.`,
        `${selectedSlot.location} is the meetup spot shown on the confirmation.`,
      ]
    : [
        'Example outcome: your order is in and the items are on hold.',
        'ASAP pickup skips the campus slot picker.',
        'We would follow up with the quickest downtown meetup once the order is reviewed.',
      ];

  return (
    <div className="pkc-shell min-h-screen bg-[radial-gradient(circle_at_top,_rgba(0,84,166,0.08),_transparent_30%),linear-gradient(180deg,#f8f8f8_0%,#efefef_100%)]">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <motion.section
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[2rem] border border-pkmn-border bg-white shadow-[0_24px_70px_rgba(0,0,0,0.08)]"
        >
          <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(135deg,rgba(0,84,166,0.16),rgba(253,183,29,0.12),rgba(255,255,255,0))]" />
          <div className="relative grid gap-8 px-6 py-8 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:py-10">
            <div>
              <p className="mb-3 text-xs font-heading font-bold uppercase tracking-[0.18rem] text-pkmn-blue">Checkout Preview</p>
              <h1 className="max-w-3xl text-4xl font-heading font-black leading-[1.02] text-pkmn-text sm:text-5xl">
                See how pickup checkout works before you place anything.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-pkmn-gray">
                This page is a sandbox version of checkout. You can click through the pickup and payment options, see what the confirmation looks like, and nothing here will submit an order or charge you.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/tcg"
                  className="inline-flex items-center gap-2 bg-pkmn-blue px-5 py-3 font-heading text-sm font-bold uppercase tracking-[0.08rem] !text-white transition-colors hover:bg-pkmn-blue-dark no-underline hover:no-underline"
                >
                  Browse the Shop <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { label: 'Campus pickup', note: 'Pick a day, time, and meetup spot', icon: CalendarDays },
                  { label: 'ASAP pickup', note: 'Skip the slot picker and plan a downtown meetup', icon: MapPin },
                  { label: 'Safe to test', note: 'You can click around here without placing or paying for anything', icon: CheckCircle2 },
                ].map(({ label, note, icon: Icon }) => (
                  <div key={label} className="border border-pkmn-border bg-pkmn-gray-light px-4 py-4">
                    <Icon className="h-5 w-5 text-pkmn-blue" />
                    <p className="mt-3 text-sm font-heading font-bold uppercase tracking-[0.08rem] text-pkmn-text">{label}</p>
                    <p className="mt-1 text-sm text-pkmn-gray">{note}</p>
                  </div>
                ))}
              </div>
            </div>

            <motion.div
              initial={false}
              animate={{ opacity: 1, x: 0 }}
              className="rounded-[1.75rem] border border-pkmn-border bg-[#f7fbff] p-5 shadow-[0_18px_45px_rgba(0,84,166,0.08)]"
            >
              <div className="rounded-[1.35rem] border border-[#dcecff] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-pkmn-border pb-4">
                  <div>
                    <p className="text-xs font-heading font-bold uppercase tracking-[0.16rem] text-pkmn-blue">What this preview covers</p>
                    <p className="mt-1 text-lg font-heading font-black text-pkmn-text">The same steps customers see at checkout</p>
                  </div>
                  <div className="bg-pkmn-blue px-3 py-1 text-[11px] font-heading font-bold uppercase tracking-[0.1rem] text-white">
                    Sandbox
                  </div>
                </div>

                <div className="mt-4 space-y-3 text-sm text-pkmn-gray">
                  <div className="border border-pkmn-border bg-pkmn-gray-light px-4 py-4">
                    <p className="font-heading font-bold uppercase tracking-[0.08rem] text-pkmn-text">1. Pickup choice</p>
                    <p className="mt-1">You pick either Scheduled Pickup or ASAP Pickup, just like the real checkout.</p>
                  </div>
                  <div className="border border-pkmn-border bg-pkmn-gray-light px-4 py-4">
                    <p className="font-heading font-bold uppercase tracking-[0.08rem] text-pkmn-text">2. Campus slot</p>
                    <p className="mt-1">If you choose scheduled pickup, you will see the same day and timeslot step.</p>
                  </div>
                  <div className="border border-pkmn-border bg-pkmn-gray-light px-4 py-4">
                    <p className="font-heading font-bold uppercase tracking-[0.08rem] text-pkmn-text">3. Payment step</p>
                    <p className="mt-1">Venmo, Zelle, PayPal, and Trade-In are shown here with the same labels as checkout.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.06fr_0.94fr]">
          <motion.div {...fadeUp} className="rounded-[1.8rem] border border-pkmn-border bg-white p-6 shadow-[0_14px_40px_rgba(0,0,0,0.05)]">
            <div className="flex items-center justify-between gap-4 border-b border-pkmn-border pb-4">
              <div>
                <p className="text-xs font-heading font-bold uppercase tracking-[0.16rem] text-pkmn-blue">Checkout Preview</p>
                <h2 className="mt-2 text-2xl font-heading font-black text-pkmn-text">Click through the flow</h2>
              </div>
              <div className="bg-pkmn-yellow/20 px-3 py-1 text-[11px] font-heading font-bold uppercase tracking-[0.1rem] text-pkmn-yellow-dark">
                Safe to test
              </div>
            </div>

            <div className="mt-5 rounded-[1.4rem] border border-pkmn-border bg-pkmn-gray-light p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-heading font-bold uppercase tracking-[0.08rem] text-pkmn-text">Sample Cart</p>
                  <p className="mt-1 text-sm text-pkmn-gray">A couple of sample items so you can see how the flow works.</p>
                </div>
                <ShoppingBag className="h-5 w-5 text-pkmn-blue" />
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { title: 'Prismatic Evolutions Booster Bundle', price: '$44.99' },
                  { title: 'Charizard ex Premium Collection', price: '$39.99' },
                ].map((item) => (
                  <div key={item.title} className="flex items-center justify-between border border-pkmn-border bg-white px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-pkmn-text">{item.title}</p>
                      <p className="text-xs text-pkmn-gray">Quantity: 1</p>
                    </div>
                    <span className="text-sm font-heading font-bold text-pkmn-blue">{item.price}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Delivery Method *</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'scheduled', label: 'Scheduled Pickup', desc: 'Choose a campus timeslot' },
                    { value: 'asap', label: 'ASAP Pickup', desc: 'Downtown pickup ASAP' },
                  ].map((option) => {
                    const isSelected = deliveryMethod === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setDeliveryMethod(option.value as DeliveryMethod);
                          setPreviewConfirmed(false);
                        }}
                        className={`rounded-[1.2rem] border-2 p-4 text-left transition-all duration-[120ms] ease-out ${
                          isSelected
                            ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue-dark'
                            : 'border-pkmn-border bg-white text-pkmn-gray-dark hover:border-pkmn-blue'
                        }`}
                      >
                        <p className="text-sm font-semibold">{option.label}</p>
                        <p className="mt-1 text-xs opacity-70">{option.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <AnimatePresence mode="wait">
                {deliveryMethod === 'scheduled' ? (
                  <motion.div
                    key="scheduled"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Pickup Timeslot *</label>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {scheduledDays.map((day) => {
                          const isActive = day.id === activeDay.id;
                          return (
                            <button
                              key={day.id}
                              type="button"
                              onClick={() => {
                                setSelectedDay(day.id);
                                setSelectedSlotId(day.slots[0].id);
                                setPreviewConfirmed(false);
                              }}
                              className={`border-2 px-4 py-2 text-sm font-medium transition-all ${
                                isActive
                                  ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue-dark'
                                  : 'border-pkmn-border bg-white text-pkmn-gray-dark hover:border-pkmn-blue'
                              }`}
                            >
                              {day.label}
                              <span className="block text-[10px] opacity-60">{day.dateLabel}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        {activeDay.slots.map((slot) => {
                          const isSelected = slot.id === selectedSlotId;
                          return (
                            <button
                              key={slot.id}
                              type="button"
                              onClick={() => {
                                setSelectedSlotId(slot.id);
                                setPreviewConfirmed(false);
                              }}
                              className={`w-full rounded-[1.2rem] border-2 p-4 text-left transition-all duration-[120ms] ease-out ${
                                isSelected
                                  ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue-dark'
                                  : 'border-pkmn-border bg-white text-pkmn-gray-dark hover:border-pkmn-blue'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className={`text-sm font-semibold ${isSelected ? 'text-pkmn-blue-dark' : 'text-pkmn-text'}`}>{slot.time}</p>
                                  <p className={`mt-1 flex items-center gap-1 text-xs ${isSelected ? 'text-pkmn-blue-dark/80' : 'text-pkmn-gray'}`}>
                                    <MapPin size={12} /> {slot.location}
                                  </p>
                                </div>
                                <span className={`px-2 py-1 text-xs font-semibold ${slot.spotsLeft <= 2 ? 'bg-orange-500/15 text-orange-600' : 'bg-green-500/15 text-green-600'}`}>
                                  {slot.spotsLeft} spot{slot.spotsLeft !== 1 ? 's' : ''} left
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="asap"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="rounded-[1.3rem] border border-pkmn-border bg-[#fff7e7] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-0.5 h-5 w-5 text-pkmn-yellow-dark" />
                      <div>
                        <p className="text-sm font-semibold text-pkmn-text">ASAP pickup uses downtown coordination</p>
                        <p className="mt-1 text-sm text-pkmn-gray">
                          In the real checkout, this option skips the campus timeslot picker and moves straight to downtown meetup planning after review.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <label className="block text-sm font-semibold text-pkmn-gray-dark mb-2">Payment Method *</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {paymentOptions.map((option) => {
                    const isSelected = paymentMethod === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(option.value);
                          setPreviewConfirmed(false);
                        }}
                        className={`border-2 px-3 py-3 text-center text-sm font-heading font-bold transition-all duration-[120ms] ease-out ${
                          isSelected
                            ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue-dark'
                            : 'border-pkmn-border bg-white text-pkmn-gray-dark hover:border-pkmn-blue'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                disabled={!canPreviewConfirm}
                onClick={() => setPreviewConfirmed(true)}
                className="inline-flex w-full items-center justify-center bg-[linear-gradient(180deg,#0c55a5_0%,#083d78_100%)] px-6 py-3.5 font-heading text-sm font-bold uppercase tracking-[0.08rem] text-white shadow-[0_18px_30px_rgba(12,85,165,0.18)] transition-all duration-[120ms] ease-out hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
              >
                Show Preview Confirmation
              </button>

              <AnimatePresence>
                {previewConfirmed && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.24, ease: 'easeOut' }}
                    className="rounded-[1.2rem] border border-green-500/20 bg-green-500/10 px-4 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                      <div>
                        <p className="text-sm font-semibold text-green-700">Preview only</p>
                        <p className="mt-1 text-sm text-green-700/90">
                          On the real site, this is where the reservation would be placed. On this page, nothing is submitted and no payment is taken.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          <motion.aside {...fadeUp} transition={{ duration: 0.45, ease: 'easeOut', delay: 0.08 }} className="rounded-[1.8rem] border border-pkmn-border bg-[#07162a] p-6 text-white shadow-[0_16px_44px_rgba(0,0,0,0.18)] lg:sticky lg:top-28 lg:self-start">
            <p className="text-xs font-heading font-bold uppercase tracking-[0.16rem] text-sky-200">Current Preview</p>
            <h2 className="mt-3 text-2xl font-heading font-black">What this checkout would look like</h2>

            <div className="mt-6 space-y-3">
              <div className="border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-[11px] font-heading font-bold uppercase tracking-[0.12rem] text-sky-200">Pickup Method</p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {deliveryMethod === 'scheduled' ? 'Scheduled Pickup' : 'ASAP Pickup'}
                </p>
                <p className="mt-1 text-sm text-white/70">
                  {deliveryMethod === 'scheduled' ? 'Campus day, time, and location selected below.' : 'Downtown meetup gets coordinated after review.'}
                </p>
              </div>

              <div className="border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-[11px] font-heading font-bold uppercase tracking-[0.12rem] text-sky-200">Pickup Details</p>
                {deliveryMethod === 'scheduled' ? (
                  <>
                    <p className="mt-2 text-sm font-semibold text-white">{activeDay.label}, {activeDay.dateLabel}</p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-white/80">
                      <Clock3 className="h-4 w-4 text-sky-200" /> {selectedSlot.time}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-white/80">
                      <MapPin className="h-4 w-4 text-sky-200" /> {selectedSlot.location}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm font-semibold text-white">Downtown ASAP pickup</p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-white/80">
                      <MessageCircle className="h-4 w-4 text-sky-200" /> Message-based coordination replaces the campus slot picker.
                    </p>
                  </>
                )}
              </div>

              <div className="border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-[11px] font-heading font-bold uppercase tracking-[0.12rem] text-sky-200">Payment</p>
                <p className="mt-2 text-sm font-semibold text-white">{selectedPaymentLabel}</p>
                <p className="mt-1 text-sm text-white/70">This matches the payment button you would choose on the real checkout.</p>
              </div>
            </div>

            <div className="mt-6 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2">
                <PackageCheck className="h-5 w-5 text-sky-200" />
                <p className="text-sm font-heading font-bold uppercase tracking-[0.08rem] text-white">Confirmation Feed</p>
              </div>
              <div className="mt-3 space-y-2">
                {confirmationFeed.map((line, index) => (
                  <motion.div
                    key={line}
                    initial={{ opacity: 0, x: 18 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.08, ease: 'easeOut' }}
                    className="border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80"
                  >
                    {line}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.aside>
        </section>

        <section className="mt-10 grid gap-5 lg:grid-cols-4">
          {afterCheckout.map(({ title, body, icon: Icon }, index) => (
            <motion.article
              key={title}
              {...fadeUp}
              transition={{ duration: 0.42, ease: 'easeOut', delay: index * 0.06 }}
              className="rounded-[1.6rem] border border-pkmn-border bg-white p-5 shadow-[0_10px_28px_rgba(0,0,0,0.05)]"
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-heading font-bold uppercase tracking-[0.16rem] text-pkmn-blue">After checkout</p>
                <Icon className="h-5 w-5 text-pkmn-blue" />
              </div>
              <h2 className="mt-4 text-xl font-heading font-black leading-tight text-pkmn-text">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-pkmn-gray">{body}</p>
            </motion.article>
          ))}
        </section>
      </main>
    </div>
  );
}
