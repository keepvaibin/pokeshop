import discord
from discord import app_commands
from discord.ext import commands


class HealthCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name='ping', description='Check whether the SCTCG bot is online.')
    async def ping(self, interaction: discord.Interaction) -> None:
        latency_ms = round(self.bot.latency * 1000)
        await interaction.response.send_message(f'Pong. Gateway latency: {latency_ms} ms.', ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(HealthCog(bot))