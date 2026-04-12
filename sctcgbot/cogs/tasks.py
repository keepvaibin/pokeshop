import logging
from typing import Any

import aiohttp
import discord
from discord.ext import commands, tasks

from api import deliver_dm_payload
from config import settings


logger = logging.getLogger(__name__)


class AutomationTasksCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.heartbeat_loop.start()

    def cog_unload(self) -> None:
        self.heartbeat_loop.cancel()

    async def _fetch_heartbeat_actions(self) -> list[dict[str, Any]]:
        url = f'{settings.django_api_base_url}/api/orders/discord-heartbeat/'
        headers = {
            'Content-Type': 'application/json',
            'X-SCTCG-Bot-API-Key': settings.sctcg_bot_api_key,
        }
        timeout = aiohttp.ClientTimeout(total=20)

        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, headers=headers, json={}) as response:
                if response.status >= 400:
                    body = await response.text()
                    logger.error('Discord heartbeat request failed (%s): %s', response.status, body)
                    return []
                payload = await response.json()
            actions = payload.get('actions') or []
            for action in actions:
                await self._execute_action(session, action)
        return actions

    async def _execute_action(self, session: aiohttp.ClientSession, action: dict[str, Any]) -> None:
        action_type = str(action.get('type') or '').strip()
        if action_type == 'dm':
            discord_id = str(action.get('discord_id') or '').strip()
            if not discord_id:
                return
            payload = {key: value for key, value in action.items() if key not in ('type', 'discord_id')}
            try:
                await deliver_dm_payload(self.bot, discord_id, payload)
            except discord.NotFound:
                logger.warning('Heartbeat DM skipped because user %s was not found.', discord_id)
            except discord.Forbidden:
                logger.warning('Heartbeat DM skipped because user %s does not allow DMs.', discord_id)
            except (discord.HTTPException, ValueError):
                logger.exception('Heartbeat DM delivery failed for user %s', discord_id)
            return

        if action_type == 'webhook':
            webhook_url = str(action.get('webhook_url') or '').strip()
            payload = action.get('payload')
            if not webhook_url or not isinstance(payload, dict):
                return
            try:
                async with session.post(webhook_url, json=payload) as response:
                    if response.status >= 400:
                        body = await response.text()
                        logger.error('Heartbeat webhook failed (%s): %s', response.status, body)
            except aiohttp.ClientError:
                logger.exception('Heartbeat webhook request failed for %s', webhook_url)

    @tasks.loop(minutes=5)
    async def heartbeat_loop(self) -> None:
        actions = await self._fetch_heartbeat_actions()
        if actions:
            logger.info('Processed %s Discord heartbeat action(s).', len(actions))

    @heartbeat_loop.before_loop
    async def before_heartbeat_loop(self) -> None:
        await self.bot.wait_until_ready()
        await self._fetch_heartbeat_actions()


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(AutomationTasksCog(bot))