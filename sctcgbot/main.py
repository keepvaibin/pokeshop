import logging

import discord
from discord.ext import commands

from config import settings


COGS = (
    'cogs.health',
    'cogs.support',
)


class SCTCGBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        super().__init__(command_prefix='!', intents=intents)

    async def setup_hook(self) -> None:
        for extension in COGS:
            await self.load_extension(extension)

        if settings.discord_guild_id:
            guild = discord.Object(id=settings.discord_guild_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()

    async def on_ready(self) -> None:
        if not self.user:
            return
        logging.info('Logged in as %s (%s)', self.user, self.user.id)


def main() -> None:
    settings.validate()
    logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(name)s: %(message)s')
    bot = SCTCGBot()
    bot.run(settings.discord_bot_token)


if __name__ == '__main__':
    main()