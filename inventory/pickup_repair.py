from __future__ import annotations

from datetime import time as dt_time

from .models import (
    CUSTOMER_PICKUP_EARLIEST_TIME,
    CUSTOMER_PICKUP_LATEST_TIME,
    MIN_RECURRING_PICKUP_WINDOW_MINUTES,
    RECURRING_PICKUP_TIME_INCREMENT_MINUTES,
    RecurringTimeslot,
)


DEFAULT_CUSTOMER_PICKUP_TIMESLOTS = [
    {
        'day_of_week': 1,
        'start_time': dt_time(14, 0),
        'end_time': dt_time(16, 0),
        'location': 'Campus pickup',
        'max_bookings': 5,
    },
    {
        'day_of_week': 4,
        'start_time': dt_time(13, 0),
        'end_time': dt_time(15, 0),
        'location': 'Campus pickup',
        'max_bookings': 5,
    },
]


def _time_to_floor_minutes(value) -> int:
    return value.hour * 60 + value.minute


def _time_to_ceil_minutes(value) -> int:
    minutes = value.hour * 60 + value.minute
    if value.second or value.microsecond:
        minutes += 1
    return minutes


def _floor_to_increment(minutes: int) -> int:
    return (minutes // RECURRING_PICKUP_TIME_INCREMENT_MINUTES) * RECURRING_PICKUP_TIME_INCREMENT_MINUTES


def _ceil_to_increment(minutes: int) -> int:
    increment = RECURRING_PICKUP_TIME_INCREMENT_MINUTES
    return ((minutes + increment - 1) // increment) * increment


def _minutes_to_time(minutes: int):
    if minutes < 0 or minutes >= 24 * 60:
        return None
    return dt_time(minutes // 60, minutes % 60)


def normalized_customer_pickup_window(start_time, end_time):
    earliest = CUSTOMER_PICKUP_EARLIEST_TIME.hour * 60 + CUSTOMER_PICKUP_EARLIEST_TIME.minute
    latest = CUSTOMER_PICKUP_LATEST_TIME.hour * 60 + CUSTOMER_PICKUP_LATEST_TIME.minute
    start_minutes = _floor_to_increment(_time_to_floor_minutes(start_time))
    end_minutes = _ceil_to_increment(_time_to_ceil_minutes(end_time))

    if start_minutes < earliest or start_minutes >= latest or end_minutes > latest:
        return None
    if end_minutes <= start_minutes:
        return None
    if end_minutes - start_minutes < MIN_RECURRING_PICKUP_WINDOW_MINUTES:
        end_minutes = start_minutes + MIN_RECURRING_PICKUP_WINDOW_MINUTES
    if end_minutes > latest:
        return None

    start_value = _minutes_to_time(start_minutes)
    end_value = _minutes_to_time(end_minutes)
    if not start_value or not end_value:
        return None
    return start_value, end_value


def _fallback_location() -> str:
    existing = (
        RecurringTimeslot.objects
        .exclude(location='')
        .order_by('-is_active', 'day_of_week', 'start_time')
        .values_list('location', flat=True)
        .first()
    )
    return existing or 'Campus pickup'


def _usable_active_timeslots_exist() -> bool:
    return any(
        timeslot.has_customer_usable_window
        for timeslot in RecurringTimeslot.objects.filter(is_active=True)
    )


def _seed_default_timeslots(summary: dict) -> None:
    default_location = _fallback_location()
    for slot_data in DEFAULT_CUSTOMER_PICKUP_TIMESLOTS:
        defaults = {
            'location': default_location,
            'max_bookings': slot_data['max_bookings'],
            'is_active': True,
        }
        timeslot, created = RecurringTimeslot.objects.get_or_create(
            day_of_week=slot_data['day_of_week'],
            start_time=slot_data['start_time'],
            end_time=slot_data['end_time'],
            defaults=defaults,
        )
        if created:
            summary['seeded'].append(timeslot.pk)
            continue

        updates = []
        if not timeslot.is_active:
            timeslot.is_active = True
            updates.append('is_active')
        if not timeslot.location:
            timeslot.location = default_location
            updates.append('location')
        if not timeslot.max_bookings:
            timeslot.max_bookings = slot_data['max_bookings']
            updates.append('max_bookings')
        if updates:
            timeslot.save(update_fields=updates)
        summary['seeded'].append(timeslot.pk)


def repair_customer_pickup_timeslots() -> dict:
    summary = {
        'repaired': [],
        'deactivated': [],
        'seeded': [],
    }

    for timeslot in RecurringTimeslot.objects.filter(is_active=True).order_by('day_of_week', 'start_time'):
        if timeslot.has_customer_usable_window:
            continue
        normalized = normalized_customer_pickup_window(timeslot.start_time, timeslot.end_time)
        if normalized:
            timeslot.start_time, timeslot.end_time = normalized
            timeslot.save(update_fields=['start_time', 'end_time'])
            summary['repaired'].append(timeslot.pk)
        else:
            timeslot.is_active = False
            timeslot.save(update_fields=['is_active'])
            summary['deactivated'].append(timeslot.pk)

    if not _usable_active_timeslots_exist():
        _seed_default_timeslots(summary)

    return summary
