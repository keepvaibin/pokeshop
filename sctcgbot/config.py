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


@dataclass(frozen=True)
class BotSettings:
    discord_bot_token: str
    django_api_base_url: str
    bot_api_key: str
    discord_guild_id: int | None
    support_category_id: int | None

    @classmethod
    def from_env(cls) -> 'BotSettings':
        return cls(
            discord_bot_token=os.environ.get('DISCORD_BOT_TOKEN', ''),
            django_api_base_url=os.environ.get('DJANGO_API_BASE_URL', 'http://localhost:8000').rstrip('/'),
            bot_api_key=os.environ.get('BOT_API_KEY', ''),
            discord_guild_id=_optional_int(os.environ.get('DISCORD_GUILD_ID')),
            support_category_id=_optional_int(os.environ.get('SUPPORT_CATEGORY_ID')),
        )

    def validate(self) -> None:
        missing = []
        if not self.discord_bot_token or self.discord_bot_token.startswith('REPLACE_'):
            missing.append('DISCORD_BOT_TOKEN')
        if not self.bot_api_key or self.bot_api_key.startswith('REPLACE_'):
            missing.append('BOT_API_KEY')
        if missing:
            joined = ', '.join(missing)
            raise RuntimeError(f'Missing required environment variables: {joined}')


settings = BotSettings.from_env()