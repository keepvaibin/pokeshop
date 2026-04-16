# SCTCG Support & Health - sctcg-py dlib module
#
# Hooks into "on-ready" to register the Discord slash command tree and sync
# /ping and /ticket commands to all configured guilds.
#
# Ported 1:1 from legacy_bot/cogs/health.py + legacy_bot/cogs/support.py.
# The CommandTree is created once and stored in kernel_ramfs so module reloads
# and network reconnects never create duplicate listeners or double-sync.

import asyncio
import importlib
import logging
import os
from typing import Any

import aiohttp
import discord
import discord.app_commands

import lib_sctcg_bridge
importlib.reload(lib_sctcg_bridge)

from lib_sctcg_bridge import (
    BridgeConfig,
    DjangoBotAPI,
    bridge_config,
)

logger = logging.getLogger(__name__)

_TREE_RAMFS_KEY = "sctcg-bridge/tree"
_TREE_SYNCED_KEY = "sctcg-bridge/tree_synced"

TICKET_CATEGORIES = [
    discord.app_commands.Choice(name="Order/Meetup Issue", value="Order/Meetup Issue"),
    discord.app_commands.Choice(name="Trade-in Inquiry", value="Trade-in Inquiry"),
    discord.app_commands.Choice(name="Bug/Other", value="Bug/Other"),
]


# ---------------------------------------------------------------------------
# Support ticket modal — exact parity with legacy_bot SupportTicketModal
# ---------------------------------------------------------------------------

class SupportTicketModal(discord.ui.Modal, title="Support Ticket"):
    details = discord.ui.TextInput(
        label="Describe your issue",
        placeholder="Give the admin team the details they need to help you.",
        style=discord.TextStyle.paragraph,
        required=True,
        max_length=2000,
    )

    def __init__(self, api: DjangoBotAPI, category: str) -> None:
        super().__init__()
        self.api = api
        self.category = category

    async def on_submit(self, interaction: discord.Interaction) -> None:
        metadata = {
            "command": "ticket",
            "category": self.category,
            "guild_id": str(interaction.guild_id) if interaction.guild_id else "",
            "channel_id": str(interaction.channel_id) if interaction.channel_id else "",
            "channel_name": getattr(interaction.channel, "name", ""),
            "user_display_name": interaction.user.display_name,
        }
        _support_cat = os.environ.get("SUPPORT_CATEGORY_ID", "").strip()
        if _support_cat:
            metadata["support_category_id"] = _support_cat

        try:
            await self.api.create_support_ticket(
                discord_id=str(interaction.user.id),
                category=self.category,
                message=str(self.details.value),
                channel_context_id=str(interaction.id),
                metadata=metadata,
            )
        except aiohttp.ClientResponseError as exc:
            detail = "The backend rejected the support ticket."
            await interaction.response.send_message(
                f"Could not send your ticket: {detail} (HTTP {exc.status})",
                ephemeral=True,
            )
            return
        except aiohttp.ClientError:
            await interaction.response.send_message(
                "Could not reach the backend to create the support ticket. Please try again.",
                ephemeral=True,
            )
            return

        await interaction.response.send_message(
            "Your ticket has been sent to the admin team!",
            ephemeral=True,
        )

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        logger.exception("SupportTicketModal.on_error for user %s", interaction.user.id)
        if not interaction.response.is_done():
            await interaction.response.send_message(
                "An unexpected error occurred. Please try again.",
                ephemeral=True,
            )


# ---------------------------------------------------------------------------
# Build and register slash commands on the provided tree
# ---------------------------------------------------------------------------

def _register_commands(tree: discord.app_commands.CommandTree, client: discord.Client) -> None:
    tree.clear_commands(guild=None)

    @tree.command(name="ping", description="Check whether the SCTCG bot is online.")
    async def ping(interaction: discord.Interaction) -> None:
        latency_ms = round(client.latency * 1000)
        await interaction.response.send_message(
            f"Pong. Gateway latency: {latency_ms} ms.",
            ephemeral=True,
        )

    @tree.command(name="ticket", description="Open a support ticket for the admin team.")
    @discord.app_commands.guild_only()
    @discord.app_commands.describe(category="What do you need help with?")
    @discord.app_commands.choices(category=TICKET_CATEGORIES)
    async def ticket(
        interaction: discord.Interaction,
        category: discord.app_commands.Choice[str],
    ) -> None:
        api = DjangoBotAPI()
        await interaction.response.send_modal(SupportTicketModal(api, category.value))


# ---------------------------------------------------------------------------
# on-ready handler
# ---------------------------------------------------------------------------

async def on_ready_sctcg_support(**kargs: Any) -> None:
    client: discord.Client = kargs["client"]
    kernel_ramfs = kargs["kernel_ramfs"]
    config: BridgeConfig = bridge_config

    # ── Create or retrieve the CommandTree ──────────────────────────────────
    # CommandTree.__init__ registers itself on client._connection so that
    # discord.py automatically dispatches INTERACTION_CREATE events to it.
    try:
        tree: discord.app_commands.CommandTree = kernel_ramfs.read_f(_TREE_RAMFS_KEY)
        logger.debug("SCTCG CommandTree already exists in kernel_ramfs; reusing.")
    except FileNotFoundError:
        tree = discord.app_commands.CommandTree(client)
        kernel_ramfs.mkdir("sctcg-bridge")
        kernel_ramfs.create_f(_TREE_RAMFS_KEY, f_type=lambda t: t, f_args=[tree])

    # ── Register commands (always re-register in case of module reload) ─────
    _register_commands(tree, client)

    # ── Sync to Discord once per uptime (not on every reconnect) ────────────
    try:
        kernel_ramfs.read_f(_TREE_SYNCED_KEY)
        logger.debug("SCTCG slash commands already synced; skipping sync.")
        return
    except FileNotFoundError:
        pass

    guild_ids = config.discord_guild_ids
    if guild_ids:
        for guild_id in guild_ids:
            guild = discord.Object(id=guild_id)
            tree.copy_global_to(guild=guild)
            try:
                synced = await tree.sync(guild=guild)
                logger.info(
                    "SCTCG: synced %d command(s) to guild %s.", len(synced), guild_id
                )
            except discord.HTTPException:
                logger.exception("SCTCG: failed to sync commands to guild %s.", guild_id)
    else:
        try:
            synced = await tree.sync()
            logger.info("SCTCG: synced %d command(s) globally.", len(synced))
        except discord.HTTPException:
            logger.exception("SCTCG: global command sync failed.")

    kernel_ramfs.mkdir("sctcg-bridge")
    kernel_ramfs.create_f(_TREE_SYNCED_KEY, f_type=lambda: True)


# ---------------------------------------------------------------------------
# sctcg-py module interface
# ---------------------------------------------------------------------------

commands: dict[str, Any] = {
    "on-ready": on_ready_sctcg_support,
}

category_info: dict[str, str] = {
    "name": "SCTCG Support",
    "description": "/ping health check and /ticket support command.",
}

version_info = "1.0.0"
