"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { Calendar } from 'lucide-react';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface RecurringSlot {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  max_bookings: number;
  is_active: boolean;
  bookings_this_week: number;
}

export interface TimeslotSelection {
  recurring_timeslot_id: number;
  pickup_date: string; // YYYY-MM-DD
}

interface PickupTimeslotSelectorProps {
  value: TimeslotSelection | null;
  onChange: (sel: TimeslotSelection | null) => void;
  error?: string;
}

function getNextDateForDay(dayOfWeek: number): string {
  const today = new Date();
  const todayDay = (today.getDay() + 6) % 7; // Convert JS Sunday=0 to Monday=0
  let diff = dayOfWeek - todayDay;
  if (diff < 0) diff += 7;
  if (diff === 0) {
    // Today — still show it
  }
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  return target.toISOString().split('T')[0];
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function PickupTimeslotSelector({ value, onChange, error }: PickupTimeslotSelectorProps) {
  const [slots, setSlots] = useState<RecurringSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get('http://localhost:8000/api/inventory/recurring-timeslots/')
      .then((r) => setSlots(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
        Loading available timeslots...
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
        <Calendar size={16} className="inline mr-1" />
        No pickup timeslots are currently available. Choose ASAP Pickup or check back later.
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        <Calendar size={14} className="inline mr-1" /> Pickup Timeslot *
      </label>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {slots.map((slot) => {
          const pickupDate = getNextDateForDay(slot.day_of_week);
          const spotsLeft = slot.max_bookings - slot.bookings_this_week;
          const isFull = spotsLeft <= 0;
          const selected = value?.recurring_timeslot_id === slot.id && value?.pickup_date === pickupDate;
          const dateObj = new Date(pickupDate + 'T00:00:00');
          const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          return (
            <button
              key={slot.id}
              type="button"
              disabled={isFull}
              onClick={() => onChange(selected ? null : { recurring_timeslot_id: slot.id, pickup_date: pickupDate })}
              className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left ${
                isFull
                  ? 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-950 opacity-60 cursor-not-allowed'
                  : selected
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                    : 'border-gray-200 dark:border-zinc-700 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-zinc-800'
              }`}
            >
              <div>
                <p className={`font-medium text-sm ${selected ? 'text-blue-800' : 'text-gray-900 dark:text-zinc-100'}`}>
                  {DAY_NAMES[slot.day_of_week]}, {dateStr}
                </p>
                <p className="text-xs text-gray-500">
                  {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                </p>
              </div>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                isFull ? 'bg-red-100 text-red-700' : spotsLeft <= 2 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
              }`}>
                {isFull ? 'Full' : `${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}
