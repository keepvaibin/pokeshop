from datetime import time as dt_time

from django.db import migrations


MIN_RECURRING_PICKUP_WINDOW_MINUTES = 30
RECURRING_PICKUP_TIME_INCREMENT_MINUTES = 15
CUSTOMER_PICKUP_EARLIEST_MINUTES = 8 * 60
CUSTOMER_PICKUP_LATEST_MINUTES = 22 * 60
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


def _time_to_floor_minutes(value):
    return value.hour * 60 + value.minute


def _time_to_ceil_minutes(value):
    minutes = value.hour * 60 + value.minute
    if value.second or value.microsecond:
        minutes += 1
    return minutes


def _floor_to_increment(minutes):
    return (minutes // RECURRING_PICKUP_TIME_INCREMENT_MINUTES) * RECURRING_PICKUP_TIME_INCREMENT_MINUTES


def _ceil_to_increment(minutes):
    increment = RECURRING_PICKUP_TIME_INCREMENT_MINUTES
    return ((minutes + increment - 1) // increment) * increment


def _minutes_to_time(minutes):
    if minutes < 0 or minutes >= 24 * 60:
        return None
    return dt_time(minutes // 60, minutes % 60)


def _is_on_increment(value):
    total_minutes = value.hour * 60 + value.minute
    return value.second == 0 and value.microsecond == 0 and total_minutes % RECURRING_PICKUP_TIME_INCREMENT_MINUTES == 0


def _is_customer_usable(slot):
    start_minutes = slot.start_time.hour * 60 + slot.start_time.minute
    end_minutes = slot.end_time.hour * 60 + slot.end_time.minute
    duration = end_minutes - start_minutes
    return (
        duration >= MIN_RECURRING_PICKUP_WINDOW_MINUTES
        and _is_on_increment(slot.start_time)
        and _is_on_increment(slot.end_time)
        and start_minutes >= CUSTOMER_PICKUP_EARLIEST_MINUTES
        and end_minutes <= CUSTOMER_PICKUP_LATEST_MINUTES
    )


def _normalized_customer_pickup_window(start_time, end_time):
    start_minutes = _floor_to_increment(_time_to_floor_minutes(start_time))
    end_minutes = _ceil_to_increment(_time_to_ceil_minutes(end_time))

    if start_minutes < CUSTOMER_PICKUP_EARLIEST_MINUTES or start_minutes >= CUSTOMER_PICKUP_LATEST_MINUTES or end_minutes > CUSTOMER_PICKUP_LATEST_MINUTES:
        return None
    if end_minutes <= start_minutes:
        return None
    if end_minutes - start_minutes < MIN_RECURRING_PICKUP_WINDOW_MINUTES:
        end_minutes = start_minutes + MIN_RECURRING_PICKUP_WINDOW_MINUTES
    if end_minutes > CUSTOMER_PICKUP_LATEST_MINUTES:
        return None

    start_value = _minutes_to_time(start_minutes)
    end_value = _minutes_to_time(end_minutes)
    if not start_value or not end_value:
        return None
    return start_value, end_value


def _fallback_location(RecurringTimeslot):
    return (
        RecurringTimeslot.objects
        .exclude(location='')
        .order_by('-is_active', 'day_of_week', 'start_time')
        .values_list('location', flat=True)
        .first()
        or 'Campus pickup'
    )


def _usable_active_timeslots_exist(RecurringTimeslot):
    return any(
        _is_customer_usable(slot)
        for slot in RecurringTimeslot.objects.filter(is_active=True)
    )


def _seed_default_timeslots(RecurringTimeslot):
    default_location = _fallback_location(RecurringTimeslot)
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


def repair_customer_pickup_timeslots(apps, schema_editor):
    RecurringTimeslot = apps.get_model('inventory', 'RecurringTimeslot')
    had_active_timeslots = RecurringTimeslot.objects.filter(is_active=True).exists()

    for slot in RecurringTimeslot.objects.filter(is_active=True).order_by('day_of_week', 'start_time'):
        if _is_customer_usable(slot):
            continue
        normalized = _normalized_customer_pickup_window(slot.start_time, slot.end_time)
        if normalized:
            slot.start_time, slot.end_time = normalized
            slot.save(update_fields=['start_time', 'end_time'])
        else:
            slot.is_active = False
            slot.save(update_fields=['is_active'])

    if had_active_timeslots and not _usable_active_timeslots_exist(RecurringTimeslot):
        _seed_default_timeslots(RecurringTimeslot)


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0039_pokeshopsettings_standard_illegal_marks_and_more'),
    ]

    operations = [
        migrations.RunPython(repair_customer_pickup_timeslots, migrations.RunPython.noop),
    ]
