import discord
from discord import app_commands
from discord.ext import commands
import requests

from api import DjangoBotAPI


class SupportCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.api = DjangoBotAPI()

    @app_commands.command(name='support', description='Create a support ticket in the Django backend.')
    @app_commands.describe(
        subject='Short summary of what you need help with.',
        details='The full support request or context for the ticket.',
        order_id='Optional order UUID to associate with this ticket.',
    )
    async def support(
        self,
        interaction: discord.Interaction,
        subject: str,
        details: str,
        order_id: str | None = None,
    ) -> None:
        if interaction.channel_id is None:
            await interaction.response.send_message('This command can only be used in a guild text channel.', ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True, thinking=True)

        try:
            ticket = self.api.create_support_ticket(
                discord_user_id=str(interaction.user.id),
                discord_channel_id=str(interaction.channel_id),
                subject=subject,
                initial_message=details,
                order_id=order_id,
                metadata={
                    'command': 'support',
                    'guild_id': str(interaction.guild_id) if interaction.guild_id else '',
                    'channel_name': getattr(interaction.channel, 'name', ''),
                    'user_display_name': interaction.user.display_name,
                },
            )
        except requests.HTTPError as exc:
            detail = 'The backend rejected the support ticket request.'
            try:
                payload = exc.response.json()
                detail = payload.get('error', detail)
            except ValueError:
                pass
            await interaction.followup.send(f'Could not create the support ticket: {detail}', ephemeral=True)
            return
        except requests.RequestException:
            await interaction.followup.send('Could not reach the Django backend to create the support ticket.', ephemeral=True)
            return

        await interaction.followup.send(
            f"Support ticket created: {ticket['ticket_id']}. A staff member can now pick it up in the backend.",
            ephemeral=True,
        )


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(SupportCog(bot))