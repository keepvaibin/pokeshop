"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, CreditCard, MapPin, MessageCircle, ShoppingBag } from 'lucide-react';
import Navbar from '../components/Navbar';

type DeliveryMethod = 'scheduled' | 'asap';

const scheduledDays = [
  {
    id: 'tue',
    label: 'Tuesday',
    dateLabel: 'Apr 28',
    slots: [
      { id: 'tue-1', time: '2:00 PM - 3:00 PM', location: 'Crown College Courtyard', spotsLeft: 3 },
      { id: 'tue-2', time: '3:15 PM - 4:00 PM', location: 'McHenry Library Steps', spotsLeft: 1 },
    ],
  },
  {
    id: 'thu',
    label: 'Thursday',
    dateLabel: 'Apr 30',
    slots: [
      { id: 'thu-1', time: '12:30 PM - 1:15 PM', location: 'Quarry Plaza', spotsLeft: 4 },
      { id: 'thu-2', time: '4:30 PM - 5:30 PM', location: 'Porter College', spotsLeft: 2 },
    ],
  },
];

export default function DeliveryInfoPage() {
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('scheduled');
  const [selectedDay, setSelectedDay] = useState(scheduledDays[0].id);
  const [selectedSlotId, setSelectedSlotId] = useState(scheduledDays[0].slots[0].id);
  const [confirmed, setConfirmed] = useState(false);

  const activeDay = useMemo(
    () => scheduledDays.find((day) => day.id === selectedDay) ?? scheduledDays[0],
    [selectedDay],
  );
  const selectedSlot = useMemo(
    () => activeDay.slots.find((slot) => slot.id === selectedSlotId) ?? activeDay.slots[0],
    [activeDay, selectedSlotId],
  );

  return (
    <div className="pkc-shell min-h-screen bg-pkmn-bg">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="border border-pkmn-border bg-white p-6 shadow-sm">
          <p className="text-xs font-heading font-bold uppercase tracking-[0.16rem] text-pkmn-blue">Checkout Preview</p>
          <h1 className="mt-2 max-w-3xl text-4xl font-heading font-black text-pkmn-text">Pickup options before you place an order</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-pkmn-gray">
            Scheduled campus pickup reserves one of the weekly slots, while ASAP pickup skips the slot picker and moves to direct Discord coordination.
          </p>
          <Link href="/tcg" className="pkc-button-primary mt-5 inline-flex items-center gap-2 no-underline hover:no-underline">
            Browse the Shop <ArrowRight size={16} />
          </Link>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="border border-pkmn-border bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between border-b border-pkmn-border pb-4">
              <div>
                <p className="text-xs font-heading font-bold uppercase tracking-[0.14rem] text-pkmn-blue">Sandbox</p>
                <h2 className="mt-1 text-2xl font-heading font-black text-pkmn-text">Try the pickup step</h2>
              </div>
              <ShoppingBag className="h-6 w-6 text-pkmn-blue" />
            </div>

            <label className="mb-2 block text-sm font-semibold text-pkmn-gray-dark">Delivery Method *</label>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { value: 'scheduled', label: 'Scheduled Pickup', desc: 'Choose a campus timeslot', icon: CalendarDays },
                { value: 'asap', label: 'ASAP Pickup', desc: 'Downtown pickup ASAP', icon: MapPin },
              ].map(({ value, label, desc, icon: Icon }) => {
                const selected = deliveryMethod === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setDeliveryMethod(value as DeliveryMethod); setConfirmed(false); }}
                    className={`border-2 p-4 text-left transition-all ${selected ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue-dark' : 'border-pkmn-border bg-white text-pkmn-gray-dark hover:border-pkmn-blue'}`}
                  >
                    <Icon className="mb-2 h-5 w-5" />
                    <p className="font-semibold text-sm">{label}</p>
                    <p className="mt-1 text-xs opacity-70">{desc}</p>
                  </button>
                );
              })}
            </div>

            {deliveryMethod === 'scheduled' ? (
              <div className="mt-5 border border-pkmn-border bg-pkmn-bg p-4">
                <label className="mb-3 block text-sm font-heading font-bold uppercase text-pkmn-text">Pickup Timeslot *</label>
                <div className="mb-3 flex flex-wrap gap-2">
                  {scheduledDays.map((day) => (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => { setSelectedDay(day.id); setSelectedSlotId(day.slots[0].id); setConfirmed(false); }}
                      className={`border-2 px-4 py-2 text-left text-sm ${activeDay.id === day.id ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue-dark' : 'border-pkmn-border bg-white text-pkmn-gray-dark'}`}
                    >
                      {day.label}<span className="block text-[10px] opacity-60">{day.dateLabel}</span>
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {activeDay.slots.map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => { setSelectedSlotId(slot.id); setConfirmed(false); }}
                      className={`w-full border-2 p-3 text-left ${selectedSlot.id === slot.id ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue-dark' : 'border-pkmn-border bg-white text-pkmn-gray-dark'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-sm">{slot.time}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs"><MapPin size={12} /> {slot.location}</p>
                        </div>
                        <span className="border border-green-600/20 bg-green-600/10 px-2 py-1 text-xs font-semibold text-green-600">{slot.spotsLeft} left</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5 border border-pkmn-yellow/30 bg-pkmn-yellow/10 p-4 text-sm text-pkmn-yellow-dark">
                <MessageCircle size={16} className="inline mr-1" /> ASAP pickup sends the order into immediate Discord coordination.
              </div>
            )}

            <button
              type="button"
              onClick={() => setConfirmed(true)}
              className="pkc-button-accent mt-5 w-full"
            >
              Show Preview Confirmation
            </button>
          </div>

          <aside className="border border-pkmn-border bg-white p-5 shadow-sm h-fit lg:sticky lg:top-28">
            <p className="text-xs font-heading font-bold uppercase tracking-[0.14rem] text-pkmn-blue">Summary</p>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-pkmn-gray">Pickup</p>
                <p className="font-semibold text-pkmn-text">{deliveryMethod === 'scheduled' ? 'Scheduled Pickup' : 'ASAP Pickup'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-pkmn-gray">Details</p>
                {deliveryMethod === 'scheduled' ? (
                  <p className="text-pkmn-gray-dark"><Clock3 size={14} className="inline mr-1" /> {activeDay.label}, {selectedSlot.time}</p>
                ) : (
                  <p className="text-pkmn-gray-dark"><MessageCircle size={14} className="inline mr-1" /> Discord coordination after checkout</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-pkmn-gray">Payment</p>
                <p className="text-pkmn-gray-dark"><CreditCard size={14} className="inline mr-1" /> Same payment options as checkout</p>
              </div>
            </div>
            {confirmed && (
              <div className="mt-5 border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-700">
                <CheckCircle2 size={15} className="inline mr-1" /> Preview only. Nothing was submitted.
              </div>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}