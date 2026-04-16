# SCTCG Admin Commands - sonnet-py cmd module
#
# Provides !set-alarm-frequency for the developer to adjust how often the
# heartbeat module re-pings on a persistent outage, without restarting the bot.
#
# The chosen frequency is written to kernel_ramfs so it survives module
# reloads and is picked up immediately by the running heartbeat loop.

import io
import os
from typing import Any, List

import discord

# kernel_ramfs key - must match _ALERT_FREQ_RAMFS_KEY in dlib_sctcg_heartbeat
_ALERT_FREQ_RAMFS_KEY = "sctcg-bridge/alert_frequency"
_ALERTS_ENABLED_RAMFS_KEY = "sctcg-bridge/alerts_enabled"
_DEFAULT_ALERT_FREQUENCY = 12  # 12 * 5 min = 1 hour

_VALID_FREQUENCIES = [1, 2, 3, 4, 6, 8, 12, 24]  # divisors of 24
_VALID_STR = "`1` `2` `3` `4` `6` `8` `12` `24`"


def _developer_id() -> int:
    raw = os.environ.get("DEVELOPER_DISCORD_ID", "").strip()
    return int(raw) if raw.isdigit() else 0


def _read_frequency(kernel_ramfs: Any) -> int:
    try:
        f = kernel_ramfs.read_f(_ALERT_FREQ_RAMFS_KEY)
        f.seek(0)
        return max(1, int(f.read()))
    except (FileNotFoundError, ValueError):
        return _DEFAULT_ALERT_FREQUENCY


def _write_frequency(kernel_ramfs: Any, n: int) -> None:
    try:
        f = kernel_ramfs.read_f(_ALERT_FREQ_RAMFS_KEY)
        f.seek(0)
        f.truncate()
        f.write(str(n))
        f.seek(0)
    except FileNotFoundError:
        try:
            kernel_ramfs.mkdir("sctcg-bridge")
        except Exception:
            pass
        kernel_ramfs.create_f(_ALERT_FREQ_RAMFS_KEY, f_type=io.StringIO, f_args=[str(n)])


def _read_alerts_enabled(kernel_ramfs: Any) -> bool:
    try:
        f = kernel_ramfs.read_f(_ALERTS_ENABLED_RAMFS_KEY)
        f.seek(0)
        return f.read().strip() != "0"
    except FileNotFoundError:
        return True


def _write_alerts_enabled(kernel_ramfs: Any, enabled: bool) -> None:
    val = "1" if enabled else "0"
    try:
        f = kernel_ramfs.read_f(_ALERTS_ENABLED_RAMFS_KEY)
        f.seek(0)
        f.truncate()
        f.write(val)
        f.seek(0)
    except FileNotFoundError:
        try:
            kernel_ramfs.mkdir("sctcg-bridge")
        except Exception:
            pass
        kernel_ramfs.create_f(_ALERTS_ENABLED_RAMFS_KEY, f_type=io.StringIO, f_args=[val])


async def set_alarm_frequency(
    message: discord.Message,
    args: List[str],
    client: discord.Client,
    **kwargs: Any,
) -> int:
    kernel_ramfs = kwargs["kernel_ramfs"]

    dev_id = _developer_id()
    if not dev_id or message.author.id != dev_id:
        await message.channel.send("Only the SCTCG developer can use this command.")
        return 1

    if not args:
        current = _read_frequency(kernel_ramfs)
        mins = current * 5
        await message.channel.send(
            f"Current alarm frequency: every **{current}** heartbeat(s) "
            f"= every **{mins} min** (~{mins // 60}h).\n"
            f"Usage: `!set-alarm-frequency <N>` where N is a divisor of 24.\n"
            f"Valid values: {_VALID_STR} "
            f"(each heartbeat = 5 min, so 12 = hourly, 24 = every 2h, 1 = every 5 min)"
        )
        return 0

    raw = args[0].strip()
    if not raw.isdigit() or int(raw) < 1:
        await message.channel.send(
            f"Frequency must be a positive integer. Valid values: {_VALID_STR} (divisors of 24)."
        )
        return 1

    n = int(raw)
    if n not in _VALID_FREQUENCIES:
        await message.channel.send(
            f"`{n}` is not valid. Valid values: {_VALID_STR}\n"
            f"Each unit = 5 min - so `12` = hourly, `6` = every 30 min, `24` = every 2 hours."
        )
        return 1

    _write_frequency(kernel_ramfs, n)
    mins = n * 5
    await message.channel.send(
        f"Alarm frequency set to every **{n}** heartbeat(s) "
        f"= every **{mins} min** (~{mins // 60}h). Takes effect immediately."
    )
    return 0


async def toggle_alerts(
    message: discord.Message,
    args: List[str],
    client: discord.Client,
    **kwargs: Any,
) -> int:
    kernel_ramfs = kwargs["kernel_ramfs"]

    dev_id = _developer_id()
    if not dev_id or message.author.id != dev_id:
        await message.channel.send("Only the SCTCG developer can use this command.")
        return 1

    if not args:
        state = _read_alerts_enabled(kernel_ramfs)
        label = "**on**" if state else "**off**"
        await message.channel.send(
            f"Developer alerts are currently {label}.\n"
            f"Usage: `!alerts on` or `!alerts off`"
        )
        return 0

    raw = args[0].strip().lower()
    if raw not in ("on", "off"):
        await message.channel.send("Usage: `!alerts on` or `!alerts off`")
        return 1

    enabled = raw == "on"
    _write_alerts_enabled(kernel_ramfs, enabled)
    label = "**on**" if enabled else "**off**"
    await message.channel.send(f"Developer alerts turned {label}. Takes effect immediately.")
    return 0


category_info = {
    "name": "sctcg-admin",
    "pretty_name": "SCTCG Admin",
    "description": "Developer-only commands for the SCTCG shop bot.",
}

commands = {
    "set-alarm-frequency": {
        "pretty_name": "set-alarm-frequency [N]",
        "description": "Set how many 5-min heartbeat cycles between repeat outage alerts. Valid: 1 2 3 4 6 8 12 24. No argument = show current.",
        "rich_description": "12 = every hour, 24 = every 2 hours, 1 = every 5 min. Only DEVELOPER_DISCORD_ID can use this. Resets to default (12) on bot restart.",
        "permission": "everyone",
        "cache": "keep",
        "execute": set_alarm_frequency,
    },
    "alerts": {
        "pretty_name": "alerts [on|off]",
        "description": "Turn developer outage DM alerts on or off. No argument = show current state.",
        "rich_description": "When off, the heartbeat loop still runs and logs errors - it just won't DM you. Resets to on on bot restart.",
        "permission": "everyone",
        "cache": "keep",
        "execute": toggle_alerts,
    },
}
