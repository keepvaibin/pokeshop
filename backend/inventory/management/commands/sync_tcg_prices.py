"""
sync_tcg_prices - Download and cache Pokemon card prices from TCGCSV.com

Usage:
    python manage.py sync_tcg_prices               # Full sync (all Pokemon groups)
    python manage.py sync_tcg_prices --group-id 3170  # Sync a single group
    python manage.py sync_tcg_prices --force        # Force re-download even if cache is fresh
"""

import json
import logging
import os
import time
from datetime import datetime, timezone as dt_tz
from decimal import Decimal, InvalidOperation
from pathlib import Path

import requests
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from inventory.models import TCGCardPrice

logger = logging.getLogger(__name__)

TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer'
POKEMON_CATEGORY_ID = 3
CACHE_DIR = Path(settings.BASE_DIR) / 'tcg_cache'
BATCH_SIZE = 2000  # Rows per bulk_create to stay within SQLite parameter limits


def get_most_recent_update_boundary():
    """Return the most recent 20:00 UTC boundary as a UTC timestamp.

    TCGCSV updates daily around 20:00 UTC. If now > today 20:00 UTC, boundary is today.
    Otherwise boundary is yesterday at 20:00 UTC.
    """
    now_utc = datetime.now(dt_tz.utc)
    today_20utc = now_utc.replace(hour=20, minute=0, second=0, microsecond=0)
    if now_utc >= today_20utc:
        return today_20utc.timestamp()
    else:
        from datetime import timedelta
        return (today_20utc - timedelta(days=1)).timestamp()


def is_cache_fresh(filepath: Path) -> bool:
    """Check if a cached file was modified after the most recent TCGCSV update boundary."""
    if not filepath.exists():
        return False
    file_mtime = os.path.getmtime(filepath)
    boundary = get_most_recent_update_boundary()
    return file_mtime > boundary


def download_json(url: str, cache_path: Path, force: bool = False) -> dict | list | None:
    """Download JSON from url, caching to disk. Returns parsed JSON or None on failure."""
    if not force and is_cache_fresh(cache_path):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass  # Re-download on corrupt cache

    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        return data
    except Exception as e:
        logger.warning('Failed to download %s: %s', url, e)
        # Fall back to stale cache if available
        if cache_path.exists():
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return None


class Command(BaseCommand):
    help = 'Sync Pokemon card prices from TCGCSV.com into TCGCardPrice model'

    def add_arguments(self, parser):
        parser.add_argument('--group-id', type=int, help='Sync only a specific group ID')
        parser.add_argument('--force', action='store_true', help='Force re-download ignoring cache freshness')

    def handle(self, *args, **options):
        force = options.get('force', False)
        single_group_id = options.get('group_id')
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        self.stdout.write('Fetching Pokemon groups from TCGCSV...')

        # Step 1: Get all Pokemon groups
        groups_url = f'{TCGCSV_BASE}/{POKEMON_CATEGORY_ID}/groups'
        groups_cache = CACHE_DIR / f'Groups_{POKEMON_CATEGORY_ID}.json'
        groups_data = download_json(groups_url, groups_cache, force=force)

        if not groups_data:
            self.stderr.write(self.style.ERROR('Failed to fetch groups data'))
            return

        # TCGCSV returns { "results": [...] } for groups
        groups = groups_data if isinstance(groups_data, list) else groups_data.get('results', [])
        if not groups:
            self.stderr.write(self.style.ERROR('No groups found in groups data'))
            return

        self.stdout.write(f'Found {len(groups)} Pokemon groups')

        if single_group_id:
            groups = [g for g in groups if g.get('groupId') == single_group_id]
            if not groups:
                self.stderr.write(self.style.ERROR(f'Group {single_group_id} not found'))
                return

        total_created = 0
        total_updated = 0
        errors = 0

        for group in groups:
            group_id = group.get('groupId')
            group_name = group.get('name', f'Group {group_id}')

            if not group_id:
                continue

            try:
                count = self._process_group(group_id, group_name, force)
                if count is not None:
                    total_updated += count
                    self.stdout.write(f'  {group_name} (ID:{group_id}): {count} prices')
                else:
                    errors += 1
            except Exception as e:
                logger.exception('Error processing group %s: %s', group_id, e)
                errors += 1
                continue

        self.stdout.write(self.style.SUCCESS(
            f'Sync complete: {total_updated} price records upserted, {errors} group errors'
        ))
        total_count = TCGCardPrice.objects.count()
        self.stdout.write(f'Total TCGCardPrice records in DB: {total_count}')

    def _process_group(self, group_id: int, group_name: str, force: bool) -> int | None:
        """Process a single group - download products + prices, upsert into DB."""
        products_url = f'{TCGCSV_BASE}/{POKEMON_CATEGORY_ID}/{group_id}/products'
        prices_url = f'{TCGCSV_BASE}/{POKEMON_CATEGORY_ID}/{group_id}/prices'
        products_cache = CACHE_DIR / f'Products_{group_id}.json'
        prices_cache = CACHE_DIR / f'Prices_{group_id}.json'

        products_data = download_json(products_url, products_cache, force=force)
        prices_data = download_json(prices_url, prices_cache, force=force)

        if not products_data or not prices_data:
            return None

        # Parse results
        products = products_data if isinstance(products_data, list) else products_data.get('results', [])
        prices = prices_data if isinstance(prices_data, list) else prices_data.get('results', [])

        if not products:
            return 0

        # Build product lookup by productId
        product_map = {}
        for p in products:
            pid = p.get('productId')
            if pid:
                product_map[pid] = p

        # Build price entries - join prices to products
        card_prices = []
        for price_entry in prices:
            pid = price_entry.get('productId')
            product = product_map.get(pid)
            if not product:
                continue

            market_price = price_entry.get('marketPrice')
            if market_price is None:
                continue

            try:
                mp = Decimal(str(market_price))
            except (InvalidOperation, TypeError, ValueError):
                continue

            name = product.get('name', '')
            clean_name = product.get('cleanName', name)
            sub_type = price_entry.get('subTypeName', 'Normal') or 'Normal'
            image_url = product.get('imageUrl', '') or ''

            # Extract rarity from extendedData array
            rarity = ''
            for ext in product.get('extendedData', []):
                if ext.get('name') == 'Rarity':
                    rarity = ext.get('displayValue', '') or ext.get('value', '')
                    break

            card_prices.append(TCGCardPrice(
                product_id=pid,
                name=name,
                clean_name=clean_name,
                group_id=group_id,
                group_name=group_name,
                image_url=image_url,
                sub_type_name=sub_type,
                rarity=rarity,
                market_price=mp,
            ))

        if not card_prices:
            return 0

        # Upsert in batches
        count = 0
        for i in range(0, len(card_prices), BATCH_SIZE):
            batch = card_prices[i:i + BATCH_SIZE]
            TCGCardPrice.objects.bulk_create(
                batch,
                update_conflicts=True,
                unique_fields=['product_id', 'sub_type_name'],
                update_fields=['name', 'clean_name', 'group_name', 'image_url', 'rarity', 'market_price', 'updated_at'],
            )
            count += len(batch)

        return count
