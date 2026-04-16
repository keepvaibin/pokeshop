# SCTCG Admin Commands — sonnet-py cmd module
#
# Provides !set-alarm-frequency for the developer to adjust how often the
# heartbeat module re-pings on a persistent outage, without restarting the bot.
#
# The chosen frequency is written to kernel_ramfs so it survives module
# reloads and is picked up immediately by the running heartbeat loop.

import importlib
from typing import Any, List

import discord

import lib_sctcg_bridge
importlib.reload(lib_sctcg_bridge)

from lib_sctcg_bridge import bridge_config

# kernel_ramfs key — must match the key read in dlib_sctcg_heartbeat
ALERT_FREQ_RAMFS_KEY = "sctcg-bridge/alert_frequency"

_DEFAULT_ALERT_FREQUENCY = 12  # 12 * 5 min = 1 hour


async def set_alarm_frequency(
    message: discord.Message,
    args: List[str],
    client: discord.Client,
    **kwargs: Any,
) -> int:
    ramfs = kwargs["ramfs"]

    # Only the configured developer may run this command
    if message.author.id != bridge_config.developer_discord_id:
        await message.channel.send("Only the SCTCG developer can use this command.")
        return 1

    if not args:
        # Show current value
        try:
            current = int(ramfs.read_f(ALERT_FREQ_RAMFS_KEY).read())
        except (FileNotFoundError, ValueError):
            current = _DEFAULT_ALERT_FREQUENCY
        mins = current * 5
        await message.channel.send(
            f"Current alarm frequency: every **{current}** heartbeat(s) "
            f"= every **{mins // 60}h** (~{mins} min).\n"
            f"Usage: `!set-alarm-frequency <N>` where N is a divisor of 24.\n"
            f"Valid values: `1` `2` `3` `4` `6` `8` `12` `24` "
            f"(heartbeats per alert cycle — each heartbeat = 5 min, 12 = hourly, 24 = every 2h, 1 = every 5 min)"
        )
        return 0

    raw = args[0].strip()
    if not raw.isdigit() or int(raw) < 1:
        await message.channel.send(
            "Frequency must be a positive integer. "
            "Valid values: `1` `2` `3` `4` `6` `8` `12` `24` (divisors of 24)."
        )
        return 1

    n = int(raw)
    if 24 % n != 0:
        await message.channel.send(
            f"`{n}` is not a divisor of 24. "
            f"Valid values: `1` `2` `3` `4` `6` `8` `12` `24`\n"
            f"Each unit = 5 min — so `12` = every hour, `6` = every 30 min, `24` = every 2 hours."
        )
        return 1

    # Write to ramfs so the running heartbeat loop picks it up immediately
    try:
        ramfs.read_f(ALERT_FREQ_RAMFS_KEY)
        # File exists — overwrite by writing to the file object
        f = ramfs.read_f(ALERT_FREQ_RAMFS_KEY)
        f.seek(0)
        f.truncate()
        f.write(str(n))
        f.seek(0)
    except FileNotFoundError:
        # First time — create the directory and file
        try:
            ramfs.mkdir("sctcg-bridge")
        except Exception:
            pass
        import io
        ramfs.create_f(ALERT_FREQ_RAMFS_KEY, f_type=io.StringIO, f_args=[str(n)])

    mins = n * 5
    await message.channel.send(
        f"Alarm frequency set to every **{n}** heartbeat(s) "
        f"= every **{mins} minutes** (~{mins // 60}h {mins % 60}m). "
        f"Takes effect immediately."
    )
    return 0


category_info = {
    "name": "sctcg-admin",
    "pretty_name": "SCTCG Admin",
    "description": "Developer-only commands for the SCTCG shop bot.",
}

commands = {
    "set-alarm-frequency": {
        "pretty_name": "set-alarm-frequency [N]",
        "description": "Set how many heartbeat cycles (5 min each) between repeat outage alerts. Must be a divisor of 24 (valid: 1 2 3 4 6 8 12 24). No argument = show current.",
        "rich_description": "12 = every hour, 24 = every 2 hours, 1 = every 5 min. Only DEVELOPER_DISCORD_ID can use this. Resets to default (12) on bot restart.",
        "permission": "everyone",
        "cache": "keep",
        "execute": set_alarm_frequency,
    },
}
