"use client";

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Calendar, MapPin } from 'lucide-react';
import { API_BASE_URL as API } from '@/app/lib/api';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
      .get(`${API}/api/inventory/recurring-timeslots/`)
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (matchingSlot) setSelectedDay(matchingSlot.day_of_week);
    }
  }, [value, selectedDay, slots]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-white0">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-pkmn-blue"></div>
        Loading available timeslots...
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="border border-pkmn-yellow/20 bg-pkmn-yellow/10 p-4 text-sm text-pkmn-yellow-dark">
        <Calendar size={16} className="inline mr-1" />
        No pickup timeslots are currently available. Choose ASAP Pickup or check back later.
      </div>
    );
  }

  const activeDaySlots = selectedDay !== null
    ? dayGroups.find(g => g.day === selectedDay)?.daySlots ?? []
    : [];

  return (
    <div className="border border-pkmn-border bg-[#f5f5f5] p-4">
      <label className="mb-3 block text-sm font-heading font-bold uppercase tracking-[0.06rem] text-pkmn-text">
        <Calendar size={14} className="inline mr-1" /> Pickup Timeslot *
      </label>

      {/* Step 1: Day buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {dayGroups.map(({ day, daySlots }) => {
          const pickupDate = daySlots[0]?.pickup_date ?? getNextDateForDay(day);
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
          {activeDaySlots.map((slot) => {
            const pickupDate = slot.pickup_date ?? getNextDateForDay(slot.day_of_week);
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
