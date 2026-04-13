from dataclasses import dataclass
from pathlib import Path
import os

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / '.env')


def _optional_int(value: str | None) -> int | None:
    if not value:
        return None
    return int(value)


def _parse_int_list(*values: str | None) -> tuple[int, ...]:
    parsed: list[int] = []
    seen: set[int] = set()
    for value in values:
        if not value:
            continue
        for chunk in value.split(','):
            chunk = chunk.strip()
            if not chunk:
                continue
            guild_id = int(chunk)
            if guild_id in seen:
                continue
            seen.add(guild_id)
            parsed.append(guild_id)
    return tuple(parsed)


@dataclass(frozen=True)
class BotSettings:
    discord_bot_token: str
    django_api_base_url: str
    sctcg_bot_api_key: str
    discord_guild_ids: tuple[int, ...]
    support_category_id: int | None
    internal_api_host: str
    internal_api_port: int

    @classmethod
    def from_env(cls) -> 'BotSettings':
        return cls(
            discord_bot_token=os.environ.get('DISCORD_BOT_TOKEN', ''),
            django_api_base_url=os.environ.get('DJANGO_API_BASE_URL', 'http://localhost:8000').rstrip('/'),
            sctcg_bot_api_key=os.environ.get('SCTCG_BOT_API_KEY') or os.environ.get('BOT_API_KEY', ''),
            discord_guild_ids=_parse_int_list(
                os.environ.get('DISCORD_GUILD_IDS'),
                os.environ.get('DISCORD_GUILD_ID'),
            ),
            support_category_id=_optional_int(os.environ.get('SUPPORT_CATEGORY_ID')),
            internal_api_host=os.environ.get('BOT_INTERNAL_API_HOST', '127.0.0.1').strip() or '127.0.0.1',
            internal_api_port=int(os.environ.get('BOT_INTERNAL_API_PORT', '8001')),
        )

    def validate(self) -> None:
        missing = []
        if not self.discord_bot_token or self.discord_bot_token.startswith('REPLACE_'):
            missing.append('DISCORD_BOT_TOKEN')
        if not self.sctcg_bot_api_key or self.sctcg_bot_api_key.startswith('REPLACE_'):
            missing.append('SCTCG_BOT_API_KEY')
        if missing:
            joined = ', '.join(missing)
            raise RuntimeError(f'Missing required environment variables: {joined}')


settings = BotSettings.from_env()