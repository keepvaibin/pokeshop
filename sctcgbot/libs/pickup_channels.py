import importlib
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

PICKUP_CATEGORY_ID = 1498798988390957148
PACIFIC_TZ = ZoneInfo("America/Los_Angeles")
ROLLING_WINDOW_DAYS = 8
CATEGORY_SWEEP_THRESHOLD = 40

logger = logging.getLogger(__name__)


def pacific_today(now=None):
    current = now or datetime.now(PACIFIC_TZ)
    if current.tzinfo is None:
        current = current.replace(tzinfo=PACIFIC_TZ)
    return current.astimezone(PACIFIC_TZ).date()


def pickup_role_name(pickup_date):
    return f"Pickup: {pickup_date.month}/{pickup_date.day}"


def pickup_channel_name(pickup_date):
    return f"pickup-{pickup_date.month}-{pickup_date.day}"


def rolling_pickup_dates(today=None):
    start = today or pacific_today()
    return [start + timedelta(days=offset) for offset in range(ROLLING_WINDOW_DAYS)]


def _target_pickup_dates(today=None, pickup_dates=None):
    if pickup_dates is None:
        return rolling_pickup_dates(today=today)
    return sorted(set(pickup_dates))


def active_pickup_names(today=None, pickup_dates=None):
    dates = _target_pickup_dates(today=today, pickup_dates=pickup_dates)
    return {
        "roles": {pickup_role_name(day) for day in dates},
        "channels": {pickup_channel_name(day) for day in dates},
    }


def expired_pickup_names(today=None, lookback_days=14):
    start = today or pacific_today()
    expired_dates = [start - timedelta(days=offset) for offset in range(1, lookback_days + 1)]
    return {
        "roles": {pickup_role_name(day) for day in expired_dates},
        "channels": {pickup_channel_name(day) for day in expired_dates},
    }


def inactive_pickup_names(today=None, pickup_dates=None):
    target_dates = set(_target_pickup_dates(today=today, pickup_dates=pickup_dates))
    inactive_dates = [pickup_date for pickup_date in rolling_pickup_dates(today=today) if pickup_date not in target_dates]
    return {
        "roles": {pickup_role_name(day) for day in inactive_dates},
        "channels": {pickup_channel_name(day) for day in inactive_dates},
    }


async def _fetch_live_channels(guild):
    fetch_channels = getattr(guild, "fetch_channels", None)
    if fetch_channels:
        return list(await fetch_channels())
    return list(getattr(guild, "channels", []))


async def _fetch_live_roles(guild):
    fetch_roles = getattr(guild, "fetch_roles", None)
    if fetch_roles:
        return list(await fetch_roles())
    return list(getattr(guild, "roles", []))


def _find_by_name(items, name):
    return next((item for item in items if getattr(item, "name", None) == name), None)


def _category_channels(channels, category):
    category_id = getattr(category, "id", None)
    return [
        channel
        for channel in channels
        if getattr(channel, "category_id", None) == category_id
        or getattr(getattr(channel, "category", None), "id", None) == category_id
    ]


def _pickup_permission_overwrites(guild, role):
    try:
        discord = importlib.import_module("discord")
    except ImportError:
        return None

    default_role = getattr(guild, "default_role", None)
    if default_role is None:
        return None
    return {
        default_role: discord.PermissionOverwrite(view_channel=False),
        role: discord.PermissionOverwrite(view_channel=True),
    }


async def _set_pickup_permissions(channel, role, *, reason):
    guild = getattr(channel, "guild", None) or getattr(role, "guild", None)
    default_role = getattr(guild, "default_role", None)
    if default_role:
        await channel.set_permissions(default_role, view_channel=False, reason=reason)
    await channel.set_permissions(role, view_channel=True, reason=reason)


async def emergency_sweep_category(guild, category, *, active_channel_names, log=None):
    log = log or logger
    channels = _category_channels(await _fetch_live_channels(guild), category)
    deleted = 0
    for channel in channels:
        if getattr(channel, "name", None) in active_channel_names:
            continue
        try:
            await channel.delete(reason="Emergency pickup rolling-window channel cap sweep")
            deleted += 1
        except Exception:
            log.exception("Failed to delete overflow pickup channel %s", getattr(channel, "id", "unknown"))
    return deleted


async def cleanup_expired_pickup_infrastructure(
    guild,
    *,
    category_id=PICKUP_CATEGORY_ID,
    today=None,
    lookback_days=14,
    log=None,
):
    log = log or logger
    expired_names = expired_pickup_names(today=today, lookback_days=lookback_days)
    channels = await _fetch_live_channels(guild)
    category = next((channel for channel in channels if getattr(channel, "id", None) == category_id), None)
    if category is None:
        get_channel = getattr(guild, "get_channel", None)
        category = get_channel(category_id) if get_channel else None
    if category is None:
        raise RuntimeError(f"Pickup category {category_id} was not found")

    result = {"channels_deleted": 0, "roles_deleted": 0, "errors": []}

    for channel in _category_channels(channels, category):
        if getattr(channel, "name", None) not in expired_names["channels"]:
            continue
        try:
            await channel.delete(reason="Delete expired pickup channel")
            result["channels_deleted"] += 1
        except Exception as exc:
            result["errors"].append(f"channel:{getattr(channel, 'id', 'unknown')}:{exc}")
            log.exception("Failed to delete expired pickup channel %s", getattr(channel, "id", "unknown"))

    roles = await _fetch_live_roles(guild)
    for role in roles:
        if getattr(role, "name", None) not in expired_names["roles"]:
            continue
        try:
            await role.delete(reason="Delete expired pickup role")
            result["roles_deleted"] += 1
        except Exception as exc:
            result["errors"].append(f"role:{getattr(role, 'id', 'unknown')}:{exc}")
            log.exception("Failed to delete expired pickup role %s", getattr(role, "id", "unknown"))

    return result


async def cleanup_inactive_pickup_infrastructure(
    guild,
    category,
    *,
    today=None,
    pickup_dates=None,
    channels=None,
    log=None,
):
    log = log or logger
    inactive_names = inactive_pickup_names(today=today, pickup_dates=pickup_dates)
    channels = channels if channels is not None else await _fetch_live_channels(guild)
    result = {"channels_deleted": 0, "roles_deleted": 0, "errors": []}

    for channel in _category_channels(channels, category):
        if getattr(channel, "name", None) not in inactive_names["channels"]:
            continue
        try:
            await channel.delete(reason="Delete pickup channel for inactive pickup date")
            result["channels_deleted"] += 1
        except Exception as exc:
            result["errors"].append(f"channel:{getattr(channel, 'id', 'unknown')}:{exc}")
            log.exception("Failed to delete inactive pickup channel %s", getattr(channel, "id", "unknown"))

    roles = await _fetch_live_roles(guild)
    for role in roles:
        if getattr(role, "name", None) not in inactive_names["roles"]:
            continue
        try:
            await role.delete(reason="Delete pickup role for inactive pickup date")
            result["roles_deleted"] += 1
        except Exception as exc:
            result["errors"].append(f"role:{getattr(role, 'id', 'unknown')}:{exc}")
            log.exception("Failed to delete inactive pickup role %s", getattr(role, "id", "unknown"))

    return result


async def ensure_rolling_window(
    guild,
    *,
    category_id=PICKUP_CATEGORY_ID,
    today=None,
    pickup_dates=None,
    channel_cap_threshold=CATEGORY_SWEEP_THRESHOLD,
    log=None,
):
    log = log or logger
    target_dates = _target_pickup_dates(today=today, pickup_dates=pickup_dates)
    active_names = active_pickup_names(today=today, pickup_dates=target_dates)

    channels = await _fetch_live_channels(guild)
    category = next((channel for channel in channels if getattr(channel, "id", None) == category_id), None)
    if category is None:
        get_channel = getattr(guild, "get_channel", None)
        category = get_channel(category_id) if get_channel else None
    if category is None:
        raise RuntimeError(f"Pickup category {category_id} was not found")

    category_channels = _category_channels(channels, category)
    if pickup_dates is not None:
        await cleanup_inactive_pickup_infrastructure(
            guild,
            category,
            today=today,
            pickup_dates=target_dates,
            channels=channels,
            log=log,
        )
        channels = await _fetch_live_channels(guild)
        category_channels = _category_channels(channels, category)

    if len(category_channels) >= channel_cap_threshold:
        await emergency_sweep_category(guild, category, active_channel_names=active_names["channels"], log=log)
        channels = await _fetch_live_channels(guild)
        category_channels = _category_channels(channels, category)

    roles = await _fetch_live_roles(guild)
    ensured = []
    for pickup_date in target_dates:
        role_name = pickup_role_name(pickup_date)
        channel_name = pickup_channel_name(pickup_date)

        role = _find_by_name(roles, role_name)
        if role is None:
            role = await guild.create_role(name=role_name, reason="Ensure pickup rolling-window role")
            roles.append(role)

        channel = _find_by_name(category_channels, channel_name)
        if channel is None:
            create_kwargs = {"reason": "Ensure pickup rolling-window channel"}
            overwrites = _pickup_permission_overwrites(guild, role)
            if overwrites:
                create_kwargs["overwrites"] = overwrites
            create_text_channel = getattr(category, "create_text_channel", None)
            if create_text_channel:
                channel = await create_text_channel(channel_name, **create_kwargs)
            else:
                channel = await guild.create_text_channel(channel_name, category=category, **create_kwargs)
            category_channels.append(channel)

        await _set_pickup_permissions(channel, role, reason="Ensure pickup rolling-window permissions")
        ensured.append({"date": pickup_date, "role": role, "channel": channel})

    return ensured