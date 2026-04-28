from datetime import date, datetime, timedelta, time as dt_time
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone


CUSTOMER_PICKUP_MIN_ADVANCE_DAYS = 1
CUSTOMER_PICKUP_CUTOFF_HOUR = 21
CUSTOMER_PICKUP_TIMEZONE = ZoneInfo('America/Los_Angeles')
CUSTOMER_PICKUP_CUTOFF_ERROR = 'Scheduled pickup must be booked before 9 PM Pacific the day before pickup.'


def coerce_pickup_date(value):
    if isinstance(value, str):
        return date.fromisoformat(value)
    return value


def as_customer_pickup_time(value):
    if timezone.is_naive(value):
        value = timezone.make_aware(value, CUSTOMER_PICKUP_TIMEZONE)
    return timezone.localtime(value, CUSTOMER_PICKUP_TIMEZONE)


def customer_pickup_cutoff(pickup_date):
    pickup_date = coerce_pickup_date(pickup_date)
    return datetime.combine(
        pickup_date - timedelta(days=CUSTOMER_PICKUP_MIN_ADVANCE_DAYS),
        dt_time(hour=CUSTOMER_PICKUP_CUTOFF_HOUR),
        tzinfo=CUSTOMER_PICKUP_TIMEZONE,
    )


def minimum_customer_pickup_date(now=None):
    now = as_customer_pickup_time(now or timezone.now())
    minimum_days = CUSTOMER_PICKUP_MIN_ADVANCE_DAYS
    cutoff_today = datetime.combine(
        now.date(),
        dt_time(hour=CUSTOMER_PICKUP_CUTOFF_HOUR),
        tzinfo=CUSTOMER_PICKUP_TIMEZONE,
    )
    if now >= cutoff_today:
        minimum_days += 1
    return now.date() + timedelta(days=minimum_days)


def validate_customer_pickup_date(pickup_date, *, now=None):
    pickup_date = coerce_pickup_date(pickup_date)
    if pickup_date is None:
        raise DjangoValidationError('pickup_date is required when using a recurring timeslot')

    if as_customer_pickup_time(now or timezone.now()) >= customer_pickup_cutoff(pickup_date):
        raise DjangoValidationError(CUSTOMER_PICKUP_CUTOFF_ERROR)

    return pickup_date


def validate_customer_pickup_datetime(pickup_datetime, *, now=None):
    return validate_customer_pickup_date(as_customer_pickup_time(pickup_datetime).date(), now=now)


def next_customer_pickup_date_for_weekday(day_of_week, *, now=None, reference_date=None):
    current_time = as_customer_pickup_time(now or timezone.now())
    reference_date = reference_date or current_time.date()
    days_until_slot = day_of_week - reference_date.weekday()
    if days_until_slot < 0:
        days_until_slot += 7

    pickup_date = reference_date + timedelta(days=days_until_slot)
    while current_time >= customer_pickup_cutoff(pickup_date):
        pickup_date += timedelta(days=7)
    return pickup_date


def next_customer_pickup_date_for_timeslot(timeslot, *, now=None, reference_date=None):
    return next_customer_pickup_date_for_weekday(
        timeslot.day_of_week,
        now=now,
        reference_date=reference_date,
    )