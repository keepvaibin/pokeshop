import logging

import discord
from discord.ext import commands

from api import InternalDMGateway
from config import settings


COGS = (
    'cogs.health',
    'cogs.support',
    'cogs.tasks',
)


class SCTCGBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        super().__init__(command_prefix='!', intents=intents)
        self.dm_gateway = InternalDMGateway(self)

    async def setup_hook(self) -> None:
        for extension in COGS:
            await self.load_extension(extension)

        await self.dm_gateway.start()

        if settings.discord_guild_ids:
            for guild_id in settings.discord_guild_ids:
                guild = discord.Object(id=guild_id)
                self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)
            logging.info('Synced application commands to guilds: %s', ', '.join(str(guild_id) for guild_id in settings.discord_guild_ids))
        else:
            await self.tree.sync()
            logging.info('Synced application commands globally.')

    async def on_ready(self) -> None:
        if not self.user:
            return
        logging.info('Logged in as %s (%s)', self.user, self.user.id)

    async def close(self) -> None:
        await self.dm_gateway.close()
        await super().close()


def main() -> None:
    settings.validate()
    logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(name)s: %(message)s')
    bot = SCTCGBot()
    bot.run(settings.discord_bot_token)


if __name__ == '__main__':
    main()