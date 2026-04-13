from __future__ import annotations

import html
import re
from collections.abc import Mapping, Sequence
from urllib.parse import urlparse

from rest_framework import serializers


_HTML_TAG_RE = re.compile(r'<[^>]+>')
_CONTROL_CHAR_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_INLINE_WHITESPACE_RE = re.compile(r'[ \t\f\v]+')
_DISCORD_SNOWFLAKE_RE = re.compile(r'^\d{15,32}$')
_COMPACT_IDENTIFIER_RE = re.compile(r'^[A-Za-z0-9_-]{8,64}$')


def sanitize_plain_text(value: str | None, *, multiline: bool = False, max_length: int | None = None) -> str:
    if value in (None, ''):
        return ''

    text = _HTML_TAG_RE.sub('', str(value))
    text = html.unescape(text)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = _CONTROL_CHAR_RE.sub('', text)
    text = text.replace('<', '').replace('>', '')

    if multiline:
        lines = [_INLINE_WHITESPACE_RE.sub(' ', line).strip() for line in text.split('\n')]
        text = '\n'.join(line for line in lines if line)
        text = re.sub(r'\n{3,}', '\n\n', text)
    else:
        text = _INLINE_WHITESPACE_RE.sub(' ', text.replace('\n', ' ')).strip()

    if max_length is not None:
        text = text[:max_length].strip()

    return text.strip()


def validate_discord_snowflake(value: str | None, *, label: str = 'Discord ID') -> str:
    cleaned = sanitize_plain_text(value, max_length=32)
    if cleaned and not _DISCORD_SNOWFLAKE_RE.fullmatch(cleaned):
        raise serializers.ValidationError(f'{label} must be a numeric Discord snowflake.')
    return cleaned


def validate_compact_identifier(value: str | None, *, label: str = 'Identifier') -> str:
    cleaned = sanitize_plain_text(value, max_length=64)
    if cleaned and not _COMPACT_IDENTIFIER_RE.fullmatch(cleaned):
        raise serializers.ValidationError(f'{label} may contain only letters, numbers, hyphens, or underscores.')
    return cleaned


def validate_http_url(value: str | None, *, label: str = 'URL') -> str:
    cleaned = sanitize_plain_text(value)
    if not cleaned:
        return ''

    parsed = urlparse(cleaned)
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
        raise serializers.ValidationError(f'{label} must be an absolute http:// or https:// URL.')
    return cleaned


def validate_navigation_url(value: str | None) -> str:
    cleaned = sanitize_plain_text(value)
    if not cleaned:
        return ''

    if cleaned.startswith('/'):
        if cleaned.startswith('//'):
            raise serializers.ValidationError('Use a site-relative path or an absolute http:// or https:// URL.')
        return cleaned

    return validate_http_url(cleaned, label='Link URL')


def validate_asset_url(value: str | None) -> str:
    cleaned = sanitize_plain_text(value)
    if not cleaned:
        return ''

    if cleaned.startswith('/'):
        if cleaned.startswith('//'):
            raise serializers.ValidationError('Asset paths must be relative to this site or use absolute http:// or https:// URLs.')
        return cleaned

    return validate_http_url(cleaned, label='Asset URL')


def sanitize_json_payload(
    value,
    *,
    max_depth: int = 4,
    max_items: int = 25,
    max_string_length: int = 500,
):
    return _sanitize_json_value(
        value,
        depth=0,
        max_depth=max_depth,
        max_items=max_items,
        max_string_length=max_string_length,
    )


def _sanitize_json_value(value, *, depth: int, max_depth: int, max_items: int, max_string_length: int):
    if depth > max_depth:
        raise serializers.ValidationError('Payload is too deeply nested.')

    if value is None or isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return value

    if isinstance(value, str):
        return sanitize_plain_text(value, multiline=True, max_length=max_string_length)

    if isinstance(value, Mapping):
        if len(value) > max_items:
            raise serializers.ValidationError('Payload has too many object properties.')

        sanitized = {}
        for raw_key, raw_item in value.items():
            key = sanitize_plain_text(str(raw_key), max_length=80)
            if not key:
                continue
            sanitized[key] = _sanitize_json_value(
                raw_item,
                depth=depth + 1,
                max_depth=max_depth,
                max_items=max_items,
                max_string_length=max_string_length,
            )
        return sanitized

    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        if len(value) > max_items:
            raise serializers.ValidationError('Payload has too many list items.')

        return [
            _sanitize_json_value(
                item,
                depth=depth + 1,
                max_depth=max_depth,
                max_items=max_items,
                max_string_length=max_string_length,
            )
            for item in value
        ]

    raise serializers.ValidationError('Payload must contain only JSON-compatible values.')