# SCTCG Heartbeat & DM Gateway — sonnet-py dlib module
#
# Hooks into "on-ready" to:
#   1. Start the internal HTTP server that Django calls to deliver DMs.
#   2. Launch a long-running background task that polls
#      /api/orders/discord-heartbeat/ every 5 minutes and executes
#      "dm" and "webhook" actions returned by the Django backend.
#
# Ported from legacy_bot/cogs/tasks.py and legacy_bot/api.py.
# State is stored in kernel_ramfs so it survives module reloads.
# The heartbeat task is guarded by name so reconnect on-ready events
# do not spawn duplicate loops.

import asyncio
import importlib
import logging
from typing import Any

import aiohttp
import discord

import lib_sctcg_bridge
importlib.reload(lib_sctcg_bridge)

from lib_sctcg_bridge import (
    BridgeConfig,
    InternalDMGateway,
    deliver_dm_payload,
    bridge_config,
)

logger = logging.getLogger(__name__)

_GATEWAY_RAMFS_KEY = "sctcg-bridge/gateway"
_ALERT_FREQ_RAMFS_KEY = "sctcg-bridge/alert_frequency"  # shared with cmd_sctcg_admin
_ALERTS_ENABLED_RAMFS_KEY = "sctcg-bridge/alerts_enabled"  # shared with cmd_sctcg_admin
_HEARTBEAT_TASK_NAME = "sctcg-heartbeat"
_HEARTBEAT_INTERVAL_SECONDS = 300  # 5 minutes - matches legacy_bot
_DEFAULT_ALERT_REPEAT_EVERY = 12   # re-ping developer every N failures (= 1 hour)

_failure_counter: int = 0  # consecutive failures; 0 means healthy


def _get_alert_frequency(kernel_ramfs: Any) -> int:
    """Read the current alert repeat frequency from ramfs, with default fallback."""
    try:
        f = kernel_ramfs.read_f(_ALERT_FREQ_RAMFS_KEY)
        f.seek(0)
        return max(1, int(f.read()))
    except (FileNotFoundError, ValueError):
        return _DEFAULT_ALERT_REPEAT_EVERY


def _alerts_enabled(kernel_ramfs: Any) -> bool:
    """Returns False only when explicitly disabled via !alerts off."""
    try:
        f = kernel_ramfs.read_f(_ALERTS_ENABLED_RAMFS_KEY)
        f.seek(0)
        return f.read().strip() != "0"
    except FileNotFoundError:
        return True  # default: on


# ---------------------------------------------------------------------------
# Developer alert helper
# ---------------------------------------------------------------------------

async def _notify_developer(
    client: discord.Client,
    config: BridgeConfig,
    message: str,
    color: discord.Color,
    kernel_ramfs: Any = None,
) -> None:
    if not config.developer_discord_id:
        return
    if kernel_ramfs is not None and not _alerts_enabled(kernel_ramfs):
        return
    try:
        user = await client.fetch_user(config.developer_discord_id)
        embed = discord.Embed(
            title="SCTCG System Alert",
            description=message,
            color=color,
        )
        await user.send(embed=embed)
    except Exception:
        logger.exception("Failed to DM developer alert to %s.", config.developer_discord_id)


# ---------------------------------------------------------------------------
# Heartbeat: action executor (mirrored from AutomationTasksCog._execute_action)
# ---------------------------------------------------------------------------

async def _execute_action(
    session: aiohttp.ClientSession,
    client: discord.Client,
    action: dict[str, Any],
) -> None:
    action_type = str(action.get("type") or "").strip()

    if action_type == "dm":
        discord_id = str(action.get("discord_id") or "").strip()
        if not discord_id:
            return
        payload = {k: v for k, v in action.items() if k not in ("type", "discord_id")}
        try:
            await deliver_dm_payload(client, discord_id, payload)
        except discord.NotFound:
            logger.warning("Heartbeat DM skipped: user %s not found.", discord_id)
        except discord.Forbidden:
            logger.warning("Heartbeat DM skipped: user %s has DMs disabled.", discord_id)
        except (discord.HTTPException, ValueError):
            logger.exception("Heartbeat DM delivery failed for user %s", discord_id)
        return

    if action_type == "webhook":
        webhook_url = str(action.get("webhook_url") or "").strip()
        webhook_payload = action.get("payload")
        if not webhook_url or not isinstance(webhook_payload, dict):
            return
        try:
            async with session.post(webhook_url, json=webhook_payload) as response:
                if response.status >= 400:
                    body = await response.text()
                    logger.error("Heartbeat webhook failed (%s): %s", response.status, body)
        except aiohttp.ClientError:
            logger.exception("Heartbeat webhook request failed for %s", webhook_url)


# ---------------------------------------------------------------------------
# Heartbeat: main loop (mirrored from AutomationTasksCog.heartbeat_loop)
# ---------------------------------------------------------------------------

async def _heartbeat_loop(client: discord.Client, config: BridgeConfig, kernel_ramfs: Any) -> None:
    global _failure_counter

    url = f"{config.django_api_base_url}/api/orders/discord-heartbeat/"
    headers = {
        "Content-Type": "application/json",
        "X-SCTCG-Bot-API-Key": config.sctcg_bot_api_key,
    }

    while True:
        alert_every = _get_alert_frequency(kernel_ramfs)

        try:
            timeout = aiohttp.ClientTimeout(total=20)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers, json={}) as response:
                    if response.status >= 400:
                        body = await response.text()
                        logger.error(
                            "Discord heartbeat request failed (%s): %s",
                            response.status,
                            body,
                        )
                        _failure_counter += 1
                        if _failure_counter == 1 or _failure_counter % alert_every == 0:
                            mins = _failure_counter * _HEARTBEAT_INTERVAL_SECONDS // 60
                            tag = "Immediate Alert" if _failure_counter == 1 else f"Persistent - ~{mins} min"
                            await _notify_developer(
                                client, config,
                                f"**API HEARTBEAT FAILURE**\nStatus: `{response.status}`\n{tag}\nCheck Azure App Service logs.",
                                discord.Color.red(),
                                kernel_ramfs,
                            )
                    else:
                        data = await response.json()
                        actions: list[dict[str, Any]] = data.get("actions") or []
                        for action in actions:
                            await _execute_action(session, client, action)
                        if _failure_counter > 0:
                            mins = _failure_counter * _HEARTBEAT_INTERVAL_SECONDS // 60
                            logger.info(
                                "Discord heartbeat restored; Django API reachable at %s.",
                                config.django_api_base_url,
                            )
                            await _notify_developer(
                                client, config,
                                f"**API Connection Restored.**\nsantacruztcg.com is back online after ~{mins} min of downtime.",
                                discord.Color.green(),
                                kernel_ramfs,
                            )
                            _failure_counter = 0
                        if actions:
                            logger.info(
                                "Processed %d Discord heartbeat action(s).", len(actions)
                            )

        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            logger.warning(
                "Discord heartbeat skipped - Django API unavailable at %s: %s",
                config.django_api_base_url,
                exc,
            )
            _failure_counter += 1
            if _failure_counter == 1 or _failure_counter % alert_every == 0:
                mins = _failure_counter * _HEARTBEAT_INTERVAL_SECONDS // 60
                tag = "Immediate Alert" if _failure_counter == 1 else f"Persistent - ~{mins} min"
                await _notify_developer(
                    client, config,
                    f"**API UNREACHABLE**\n`{exc}`\n{tag}\nCheck Azure App Service / VM networking.",
                    discord.Color.orange(),
                    kernel_ramfs,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Unexpected error in heartbeat loop; will retry in %ds.", _HEARTBEAT_INTERVAL_SECONDS)
            _failure_counter += 1
            if _failure_counter == 1 or _failure_counter % alert_every == 0:
                await _notify_developer(
                    client, config,
                    f"**BOT CRITICAL ERROR**\nHeartbeat loop exception - check VM process status.",
                    discord.Color.dark_red(),
                    kernel_ramfs,
                )

        await asyncio.sleep(_HEARTBEAT_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# on-ready handler
# ---------------------------------------------------------------------------

async def on_ready_sctcg(**kargs: Any) -> None:
    client: discord.Client = kargs["client"]
    kernel_ramfs = kargs["kernel_ramfs"]
    config: BridgeConfig = bridge_config

    # ── 1. Start Internal DM Gateway (once; survives reconnects via kernel_ramfs) ──
    try:
        kernel_ramfs.read_f(_GATEWAY_RAMFS_KEY)
        logger.debug("SCTCG DM gateway already running; skipping start.")
    except FileNotFoundError:
        gateway = InternalDMGateway(client, config)
        try:
            await gateway.start()
        except OSError as exc:
            logger.error(
                "SCTCG DM gateway failed to bind on %s:%s — %s",
                config.internal_api_host,
                config.internal_api_port,
                exc,
            )
            return
        kernel_ramfs.mkdir("sctcg-bridge")
        kernel_ramfs.create_f(_GATEWAY_RAMFS_KEY, f_type=lambda g: g, f_args=[gateway])

    # ── 2. Launch Heartbeat Task (once; guard by task name across reconnects) ──
    already_running = any(
        t.get_name() == _HEARTBEAT_TASK_NAME
        for t in asyncio.all_tasks()
        if not t.done()
    )
    if already_running:
        logger.debug("SCTCG heartbeat task already running; skipping launch.")
        return

    asyncio.create_task(_heartbeat_loop(client, config, kernel_ramfs), name=_HEARTBEAT_TASK_NAME)
    logger.info("SCTCG heartbeat task started (interval: %ds).", _HEARTBEAT_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# sonnet-py module interface
# ---------------------------------------------------------------------------

commands: dict[str, Any] = {
    "on-ready": on_ready_sctcg,
}

category_info: dict[str, str] = {
    "name": "SCTCG Bridge",
    "description": "Django heartbeat poller and DM gateway.",
}

version_info = "1.0.0"
