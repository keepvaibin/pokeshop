# SCTCG Heartbeat & DM Gateway — sonnet-py dlib module
#
# Hooks into "on-ready" to:
#   1. Start the internal HTTP server that Django calls to deliver DMs.
#   2. Launch a long-running background asyncio task that polls
#      /api/orders/discord-heartbeat/ every 5 minutes and executes
#      "dm" and "webhook" actions returned by the Django backend.
#
# State is stored in kernel_ramfs so it survives module reloads.
# The heartbeat task is guarded by name so on-ready reconnects
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
_HEARTBEAT_TASK_NAME = "sctcg-heartbeat"


# ---------------------------------------------------------------------------
# Heartbeat loop — polls Django and dispatches actions
# ---------------------------------------------------------------------------

async def _execute_action(session: aiohttp.ClientSession, client: discord.Client, action: dict[str, Any]) -> None:
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


async def _heartbeat_loop(client: discord.Client, config: BridgeConfig) -> None:
    url = f"{config.django_api_base_url}/api/orders/discord-heartbeat/"
    headers = {
        "Content-Type": "application/json",
        "X-SCTCG-Bot-API-Key": config.sctcg_bot_api_key,
    }
    backend_unavailable = False

    while True:
        try:
            timeout = aiohttp.ClientTimeout(total=20)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers, json={}) as response:
                    if response.status >= 400:
                        body = await response.text()
                        logger.error("Heartbeat request failed (%s): %s", response.status, body)
                        await asyncio.sleep(300)
                        continue
                    data = await response.json()

                actions = data.get("actions") or []
                for action in actions:
                    await _execute_action(session, client, action)

            if backend_unavailable:
                logger.info("Heartbeat restored; Django API reachable at %s.", config.django_api_base_url)
                backend_unavailable = False

            if actions:
                logger.info("Processed %d Discord heartbeat action(s).", len(actions))

        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            if not backend_unavailable:
                logger.warning("Heartbeat skipped: Django API unavailable at %s: %s", config.django_api_base_url, exc)
                backend_unavailable = True

        await asyncio.sleep(300)


# ---------------------------------------------------------------------------
# on-ready handler
# ---------------------------------------------------------------------------

async def on_ready_sctcg(**kargs: Any) -> None:
    client: discord.Client = kargs["client"]
    kernel_ramfs = kargs["kernel_ramfs"]
    config = bridge_config

    # ── 1. Start Internal DM Gateway (once; survives reloads via kernel_ramfs) ──
    try:
        kernel_ramfs.read_f(_GATEWAY_RAMFS_KEY)
        logger.debug("SCTCG DM gateway already running; skipping start.")
    except FileNotFoundError:
        gateway = InternalDMGateway(client, config)
        await gateway.start()
        # Store in kernel_ramfs so module reloads don't lose the reference
        kernel_ramfs.mkdir("sctcg-bridge")
        kernel_ramfs.create_f(_GATEWAY_RAMFS_KEY, f_type=lambda g: g, f_args=[gateway])

    # ── 2. Launch Heartbeat Task (once; guard by task name) ──
    already_running = any(
        t.get_name() == _HEARTBEAT_TASK_NAME
        for t in asyncio.all_tasks()
        if not t.done()
    )
    if already_running:
        logger.debug("SCTCG heartbeat task already running; skipping launch.")
        return

    asyncio.create_task(_heartbeat_loop(client, config), name=_HEARTBEAT_TASK_NAME)
    logger.info("SCTCG heartbeat task started (interval: 5 min).")


# ---------------------------------------------------------------------------
# sonnet-py module interface
# ---------------------------------------------------------------------------

commands: dict[str, Any] = {
    "on-ready": on_ready_sctcg,
}

category_info: dict[str, str] = {
    "name": "SCTCG Bridge",
    "description": "Django heartbeat and DM gateway integration.",
}

version_info = "1.0.0"
