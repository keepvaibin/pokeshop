import asyncio

import discord
from discord import app_commands
from discord.ext import commands
import requests

from api import DjangoBotAPI
from config import settings


TICKET_CATEGORIES = [
    app_commands.Choice(name='Order/Meetup Issue', value='Order/Meetup Issue'),
    app_commands.Choice(name='Trade-in Inquiry', value='Trade-in Inquiry'),
    app_commands.Choice(name='Bug/Other', value='Bug/Other'),
]


class SupportTicketModal(discord.ui.Modal, title='Support Ticket'):
    details = discord.ui.TextInput(
        label='Describe your issue',
        placeholder='Give the admin team the details they need to help you.',
        style=discord.TextStyle.paragraph,
        required=True,
        max_length=2000,
    )

    def __init__(self, api: DjangoBotAPI, category: str):
        super().__init__()
        self.api = api
        self.category = category

    async def on_submit(self, interaction: discord.Interaction) -> None:
        metadata = {
            'command': 'ticket',
            'category': self.category,
            'guild_id': str(interaction.guild_id) if interaction.guild_id else '',
            'channel_id': str(interaction.channel_id) if interaction.channel_id else '',
            'channel_name': getattr(interaction.channel, 'name', ''),
            'user_display_name': interaction.user.display_name,
        }
        if settings.support_category_id:
            metadata['support_category_id'] = str(settings.support_category_id)

        try:
            await asyncio.to_thread(
                self.api.create_support_ticket,
                discord_id=str(interaction.user.id),
                category=self.category,
                message=str(self.details.value),
                channel_context_id=str(interaction.id),
                metadata=metadata,
            )
        except requests.HTTPError as exc:
            detail = 'The backend rejected the support ticket.'
            response = getattr(exc, 'response', None)
            if response is not None:
                try:
                    payload = response.json()
                    detail = payload.get('error', detail)
                except ValueError:
                    pass
            await interaction.response.send_message(f'Could not send your ticket: {detail}', ephemeral=True)
            return
        except requests.RequestException:
            await interaction.response.send_message('Could not reach the Django backend to create the support ticket.', ephemeral=True)
            return

        await interaction.response.send_message('Your ticket has been sent to the admin team!', ephemeral=True)


class SupportCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.api = DjangoBotAPI()

    @app_commands.command(name='ticket', description='Open a support ticket for the admin team.')
    @app_commands.guild_only()
    @app_commands.describe(category='What do you need help with?')
    @app_commands.choices(category=TICKET_CATEGORIES)
    async def ticket(self, interaction: discord.Interaction, category: app_commands.Choice[str]) -> None:
        await interaction.response.send_modal(SupportTicketModal(self.api, category.value))


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(SupportCog(bot))