"use client";

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Calendar, MapPin, AlertCircle } from 'lucide-react';
import { API_BASE_URL as API } from '@/app/lib/api';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIN_PICKUP_ADVANCE_DAYS = 1;

interface RecurringSlot {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string;
  max_bookings: number;
  is_active: boolean;
  pickup_date?: string;
  bookings_this_week: number;
}

interface StoreAvailability {
  is_ooo: boolean;
  ooo_until: string | null;
  orders_disabled: boolean;
}

export interface TimeslotSelection {
  recurring_timeslot_id: number;
  pickup_date: string; // YYYY-MM-DD
}

interface PickupTimeslotSelectorProps {
  value: TimeslotSelection | null;
  onChange: (sel: TimeslotSelection | null) => void;
  error?: string;
  emptyMessage?: string;
  label?: string;
}

function getNextDateForDay(dayOfWeek: number, afterDate?: Date): string {
  const ref = afterDate || new Date();
  const refDay = (ref.getDay() + 6) % 7; // Convert JS Sunday=0 to Monday=0
  let diff = dayOfWeek - refDay;
  if (diff <= 0) diff += 7;
  const target = new Date(ref);
  target.setDate(ref.getDate() + diff);
  return target.toISOString().split('T')[0];
}

/** Ensure pickup date is at least 1 calendar day from today; bump by 7 if not */
function enforceMinAdvance(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setDate(today.getDate() + MIN_PICKUP_ADVANCE_DAYS);
  const d = new Date(dateStr + 'T00:00:00');
  if (d < minDate) {
    d.setDate(d.getDate() + 7);
  }
  return d.toISOString().split('T')[0];
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function PickupTimeslotSelector({ value, onChange, error, emptyMessage, label }: PickupTimeslotSelectorProps) {
  const [slots, setSlots] = useState<RecurringSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [availability, setAvailability] = useState<StoreAvailability>({ is_ooo: false, ooo_until: null, orders_disabled: false });

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/api/inventory/recurring-timeslots/`).then(r => r.data.results ?? r.data),
      axios.get(`${API}/api/inventory/settings/`).then(r => r.data),
    ]).then(([slotsData, settingsData]) => {
      setSlots(slotsData);
      setAvailability({
        is_ooo: !!settingsData.is_ooo,
        ooo_until: settingsData.ooo_until || null,
        orders_disabled: !!settingsData.orders_disabled,
      });
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // When OOO is active, calculate the date after which timeslots are available
  const oooReturnDate = useMemo(() => {
    if (!availability.is_ooo || !availability.ooo_until) return null;
    // ooo_until is the return date (inclusive of OOO). Slots start the day AFTER.
    const d = new Date(availability.ooo_until + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d;
  }, [availability]);

  // Group slots by day_of_week, computing the correct pickup date
  // If OOO, the pickup date should be the first occurrence of that day after the OOO period
  const dayGroups = useMemo(() => {
    const map = new Map<number, { slot: RecurringSlot; pickupDate: string }[]>();
    for (const s of slots) {
      let pickupDate: string;
      if (oooReturnDate) {
        // Find the next occurrence of this day_of_week on or after oooReturnDate
        pickupDate = getNextDateForDay(s.day_of_week, new Date(oooReturnDate.getTime() - 86400000));
        // If the computed date is before oooReturnDate, skip forward a week
        if (new Date(pickupDate + 'T00:00:00') < oooReturnDate) {
          const d = new Date(pickupDate + 'T00:00:00');
          d.setDate(d.getDate() + 7);
          pickupDate = d.toISOString().split('T')[0];
        }
      } else {
        pickupDate = s.pickup_date ?? getNextDateForDay(s.day_of_week);
      }
      // Always enforce the minimum advance window for customer pickups.
      pickupDate = enforceMinAdvance(pickupDate);
      if (!map.has(s.day_of_week)) map.set(s.day_of_week, []);
      map.get(s.day_of_week)!.push({ slot: s, pickupDate });
    }
    return Array.from(map.entries())
      .sort(([, aEntries], [, bEntries]) => {
        const aDate = aEntries[0]?.pickupDate ?? '';
        const bDate = bEntries[0]?.pickupDate ?? '';
        return aDate.localeCompare(bDate);
      })
      .map(([day, entries]) => ({ day, entries }));
  }, [slots, oooReturnDate]);

  // Auto-select day if the current selection maps to a specific day
  useEffect(() => {
    if (value && selectedDay === null) {
      const matchingSlot = slots.find(s => s.id === value.recurring_timeslot_id);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (matchingSlot) setSelectedDay(matchingSlot.day_of_week);
    }
  }, [value, selectedDay, slots]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-pkmn-gray">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-pkmn-blue"></div>
        Loading available timeslots...
      </div>
    );
  }

  // Orders completely disabled
  if (availability.orders_disabled) {
    return (
      <div className="border-2 border-pkmn-red/20 bg-pkmn-red/5 p-5 text-center">
        <AlertCircle size={24} className="mx-auto mb-2 text-pkmn-red" />
        <p className="text-sm font-semibold text-pkmn-red">Orders are not being accepted right now.</p>
        <p className="mt-1 text-xs text-pkmn-red/70">Please try again later.</p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="border border-pkmn-yellow/20 bg-pkmn-yellow/10 p-4 text-sm text-pkmn-yellow-dark">
        <Calendar size={16} className="inline mr-1" />
        {emptyMessage || 'No pickup timeslots are currently available. Choose ASAP Pickup or check back later.'}
      </div>
    );
  }

  const activeDayEntries = selectedDay !== null
    ? dayGroups.find(g => g.day === selectedDay)?.entries ?? []
    : [];

  return (
    <div className="border border-pkmn-border bg-[#f5f5f5] p-4">
      <label className="mb-3 block text-sm font-heading font-bold uppercase tracking-[0.06rem] text-pkmn-text">
        <Calendar size={14} className="inline mr-1" /> {label || 'Pickup Timeslot'} *
      </label>

      {availability.is_ooo && availability.ooo_until && (
        <div className="mb-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
          <AlertCircle size={12} className="inline mr-1" />
          The shop is out of office until <strong>{new Date(availability.ooo_until + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>. Showing the next available pickup dates.
        </div>
      )}

      {/* Step 1: Day buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {dayGroups.map(({ day, entries }) => {
          const pickupDate = entries[0]?.pickupDate ?? getNextDateForDay(day);
          const dateObj = new Date(pickupDate + 'T00:00:00');
          const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const isActive = selectedDay === day;

          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(isActive ? null : day)}
              className={`border-2 px-4 py-2 text-left text-sm font-medium transition-all ${
                isActive
                  ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark'
                  : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'
              }`}
            >
              {DAY_NAMES[day]}
              <span className="block text-[10px] opacity-60">{dateStr}</span>
            </button>
          );
        })}
      </div>

      {/* Step 2: Time slots for the selected day */}
      {selectedDay !== null && (
        <div className="space-y-2">
          {activeDayEntries.map(({ slot, pickupDate }) => {
            const spotsLeft = slot.max_bookings - slot.bookings_this_week;
            const isFull = spotsLeft <= 0;
            const selected = value?.recurring_timeslot_id === slot.id && value?.pickup_date === pickupDate;

            return (
              <button
                key={slot.id}
                type="button"
                disabled={isFull}
                onClick={() => onChange(selected ? null : { recurring_timeslot_id: slot.id, pickup_date: pickupDate })}
                className={`w-full flex items-center justify-between border-2 p-3 transition-all text-left ${
                  isFull
                    ? 'border-pkmn-border bg-pkmn-bg opacity-60 cursor-not-allowed'
                    : selected
                      ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark'
                      : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'
                }`}
              >
                <div>
                  <p className={`font-medium text-sm ${selected ? 'text-pkmn-blue-dark' : 'text-pkmn-text'}`}>
                    {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                  </p>
                  {slot.location && (
                    <p className={`mt-1 flex items-center gap-1 text-xs ${selected ? 'text-pkmn-blue-dark/80' : 'text-pkmn-gray'}`}>
                      <MapPin size={12} /> {slot.location}
                    </p>
                  )}
                </div>
                <span className={`border px-2 py-1 text-xs font-semibold uppercase tracking-[0.05rem] ${
                  isFull ? 'border-pkmn-red/20 bg-pkmn-red/15 text-pkmn-red' : spotsLeft <= 2 ? 'border-orange-500/20 bg-orange-500/15 text-orange-600' : 'border-green-600/20 bg-green-600/10 text-green-600'
                }`}>
                  {isFull ? 'Full' : `${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-pkmn-red text-xs mt-1">{error}</p>}
    </div>
  );
}
