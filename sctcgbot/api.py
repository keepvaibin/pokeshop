import logging
import uuid
from typing import Any

from aiohttp import web
import discord
import requests

from config import settings


logger = logging.getLogger(__name__)


def _parse_hex_color(value: Any) -> int:
    if isinstance(value, int):
        return value
    normalized = str(value).strip().lstrip('#')
    if len(normalized) == 3:
        normalized = ''.join(character * 2 for character in normalized)
    if len(normalized) != 6:
        raise ValueError('color must be a 6-digit hex value.')
    return int(normalized, 16)


def _normalize_embed_fields(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    fields: list[dict[str, Any]] = []
    for raw_field in value[:25]:
        if not isinstance(raw_field, dict):
            continue
        name = str(raw_field.get('name') or '').strip()
        field_value = str(raw_field.get('value') or '').strip()
        if not name or not field_value:
            continue
        fields.append({
            'name': name[:256],
            'value': field_value[:1024],
            'inline': bool(raw_field.get('inline', False)),
        })
    return fields


def _build_link_view(value: Any) -> discord.ui.View | None:
    if not isinstance(value, dict):
        return None

    label = str(value.get('label') or '').strip()
    url = str(value.get('url') or '').strip()
    if not label or not url:
        return None

    view = discord.ui.View(timeout=None)
    view.add_item(discord.ui.Button(label=label[:80], url=url))
    return view


async def deliver_dm_payload(bot: discord.Client, discord_id: str, payload: dict[str, Any]) -> None:
    title = str(payload.get('title') or '').strip()
    description = str(payload.get('description') or '').strip()
    color_value = _parse_hex_color(payload.get('color') or '')
    url = str(payload.get('url') or '').strip()
    thumbnail_url = str(payload.get('thumbnail_url') or '').strip()

    if not title or not description:
        raise ValueError('title and description are required.')

    user_id = int(discord_id)
    user = bot.get_user(user_id)
    if user is None:
        user = await bot.fetch_user(user_id)

    embed = discord.Embed(
        title=title[:256],
        description=description[:4096],
        color=color_value,
    )
    if url:
        embed.url = url
    if thumbnail_url.startswith(('http://', 'https://')):
        embed.set_thumbnail(url=thumbnail_url)

    for field in _normalize_embed_fields(payload.get('fields')):
        embed.add_field(name=field['name'], value=field['value'], inline=field['inline'])

    view = _build_link_view(payload.get('button'))
    if view is not None:
        await user.send(embed=embed, view=view)
        return
    await user.send(embed=embed)


class DjangoBotAPI:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, timeout: int = 10):
        self.base_url = (base_url or settings.django_api_base_url).rstrip('/')
        self.api_key = api_key or settings.sctcg_bot_api_key
        self.timeout = timeout

    @property
    def headers(self) -> dict[str, str]:
        return {
            'Content-Type': 'application/json',
            'X-SCTCG-Bot-API-Key': self.api_key,
        }

    def create_support_ticket(
        self,
        discord_id: str,
        category: str,
        message: str,
        channel_context_id: str | None = None,
        order_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            'discord_id': discord_id,
            'discord_user_id': discord_id,
            'discord_channel_id': (channel_context_id or uuid.uuid4().hex[:32])[:32],
            'category': category,
            'subject': category,
            'message': message,
            'initial_message': message,
            'metadata': metadata or {},
        }
        if order_id:
            payload['order_id'] = order_id

        response = requests.post(
            f'{self.base_url}/api/orders/support-tickets/',
            json=payload,
            headers=self.headers,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()


class InternalDMGateway:
    def __init__(self, bot: discord.Client):
        self.bot = bot
        self.runner: web.AppRunner | None = None
        self.site: web.TCPSite | None = None
        self.app = web.Application()
        self.app.add_routes([web.post('/send_dm', self.send_dm)])

    async def start(self) -> None:
        if self.runner is not None:
            return
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, settings.internal_api_host, settings.internal_api_port)
        await self.site.start()
        logger.info(
            'Internal DM gateway listening on http://%s:%s/send_dm',
            settings.internal_api_host,
            settings.internal_api_port,
        )

    async def close(self) -> None:
        if self.runner is None:
            return
        await self.runner.cleanup()
        self.runner = None
        self.site = None

    def _is_authorized(self, request: web.Request) -> bool:
        raw_key = (
            request.headers.get('X-SCTCG-Bot-API-Key')
            or request.headers.get('X-Bot-API-Key')
            or ''
        ).strip()
        return bool(raw_key) and raw_key == settings.sctcg_bot_api_key

    async def send_dm(self, request: web.Request) -> web.Response:
        if not self._is_authorized(request):
            return web.json_response({'error': 'Valid SCTCG bot API key required.'}, status=403)

        try:
            payload = await request.json()
        except Exception:
            return web.json_response({'error': 'Invalid JSON payload.'}, status=400)

        discord_id = str(payload.get('discord_id') or '').strip()
        title = str(payload.get('title') or '').strip()
        description = str(payload.get('description') or '').strip()
        color = payload.get('color')

        if not discord_id or not title or not description or not color:
            return web.json_response(
                {'error': 'discord_id, title, description, and color are required.'},
                status=400,
            )

        try:
            _parse_hex_color(color)
            int(discord_id)
        except (TypeError, ValueError):
            return web.json_response({'error': 'Invalid discord_id or color.'}, status=400)

        try:
            await deliver_dm_payload(self.bot, discord_id, payload)
        except discord.NotFound:
            return web.json_response({'error': 'Discord user not found.'}, status=404)
        except discord.Forbidden:
            return web.json_response({'error': 'Discord DM could not be delivered.'}, status=403)
        except ValueError as exc:
            return web.json_response({'error': str(exc)}, status=400)
        except discord.HTTPException:
            logger.exception('Discord DM gateway failed for user %s', discord_id)
            return web.json_response({'error': 'Discord API request failed.'}, status=502)

        return web.json_response({'ok': True, 'discord_id': discord_id})