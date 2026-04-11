"use client";

import { useEffect, useMemo, useState } from 'react';
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
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    axios
      .get('http://localhost:8000/api/inventory/recurring-timeslots/')
      .then((r) => setSlots(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Group slots by day_of_week, only include days that have at least one slot
  const dayGroups = useMemo(() => {
    const map = new Map<number, RecurringSlot[]>();
    for (const s of slots) {
      if (!map.has(s.day_of_week)) map.set(s.day_of_week, []);
      map.get(s.day_of_week)!.push(s);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([day, daySlots]) => ({ day, daySlots }));
  }, [slots]);

  // Auto-select day if the current selection maps to a specific day
  useEffect(() => {
    if (value && selectedDay === null) {
      const matchingSlot = slots.find(s => s.id === value.recurring_timeslot_id);
      if (matchingSlot) setSelectedDay(matchingSlot.day_of_week);
    }
  }, [value, selectedDay, slots]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-zinc-500 dark:text-zinc-400">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
        Loading available timeslots...
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800 dark:text-yellow-300">
        <Calendar size={16} className="inline mr-1" />
        No pickup timeslots are currently available. Choose ASAP Pickup or check back later.
      </div>
    );
  }

  const activeDaySlots = selectedDay !== null
    ? dayGroups.find(g => g.day === selectedDay)?.daySlots ?? []
    : [];

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 dark:text-zinc-400 mb-2">
        <Calendar size={14} className="inline mr-1" /> Pickup Timeslot *
      </label>

      {/* Step 1: Day buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {dayGroups.map(({ day }) => {
          const pickupDate = getNextDateForDay(day);
          const dateObj = new Date(pickupDate + 'T00:00:00');
          const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const isActive = selectedDay === day;

          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(isActive ? null : day)}
              className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                isActive
                  ? 'bg-blue-50 border-blue-600 text-blue-900 dark:bg-blue-900/30 dark:border-blue-500 dark:text-blue-100'
                  : 'bg-white border-gray-200 dark:bg-zinc-900 dark:border-zinc-800 text-gray-700 dark:text-zinc-400 hover:border-blue-300 dark:hover:border-zinc-700'
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
          {activeDaySlots.map((slot) => {
            const pickupDate = getNextDateForDay(slot.day_of_week);
            const spotsLeft = slot.max_bookings - slot.bookings_this_week;
            const isFull = spotsLeft <= 0;
            const selected = value?.recurring_timeslot_id === slot.id && value?.pickup_date === pickupDate;

            return (
              <button
                key={slot.id}
                type="button"
                disabled={isFull}
                onClick={() => onChange(selected ? null : { recurring_timeslot_id: slot.id, pickup_date: pickupDate })}
                className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left ${
                  isFull
                    ? 'border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 opacity-60 cursor-not-allowed'
                    : selected
                      ? 'bg-blue-50 border-blue-600 dark:bg-blue-900/30 dark:border-blue-500 text-blue-900 dark:text-blue-100'
                      : 'bg-white border-gray-200 dark:bg-zinc-900 dark:border-zinc-800 text-gray-700 dark:text-zinc-400 hover:border-blue-300 dark:hover:border-zinc-700'
                }`}
              >
                <div>
                  <p className={`font-medium text-sm ${selected ? 'text-blue-900 dark:text-blue-100' : 'text-gray-900 dark:text-zinc-100'}`}>
                    {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
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
      )}

      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}
