from typing import Any

import requests

from config import settings


class DjangoBotAPI:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, timeout: int = 10):
        self.base_url = (base_url or settings.django_api_base_url).rstrip('/')
        self.api_key = api_key or settings.bot_api_key
        self.timeout = timeout

    @property
    def headers(self) -> dict[str, str]:
        return {
            'Content-Type': 'application/json',
            'X-Bot-API-Key': self.api_key,
        }

    def create_support_ticket(
        self,
        discord_user_id: str,
        discord_channel_id: str,
        subject: str,
        initial_message: str = '',
        order_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            'discord_user_id': discord_user_id,
            'discord_channel_id': discord_channel_id,
            'subject': subject,
            'initial_message': initial_message,
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