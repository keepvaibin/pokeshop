import requests as _requests
import time as _time
import re as _re
import logging
from datetime import date as _date, timedelta as _timedelta
from decimal import Decimal as _Decimal, ROUND_DOWN as _ROUND_DOWN, ROUND_HALF_UP as _ROUND_HALF_UP
from urllib.parse import quote_plus as _quote_plus
from requests import RequestException as RequestsRequestException
from rest_framework import generics, permissions, viewsets, status
from rest_framework.decorators import api_view, permission_classes as perm_classes_decorator
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Count, Max, Prefetch, Q
from django.db.models import Case, IntegerField, Value, When
from django.core.cache import cache
from django.utils import timezone as tz
from orders.scheduling import minimum_customer_pickup_date, next_customer_pickup_date_for_timeslot

_SETS_CACHE: dict = {'data': None, 'ts': 0.0}
logger = logging.getLogger(__name__)

from .models import (
    Item, ItemImage, WantedCard, PickupSlot, PokeshopSettings,
    PickupTimeslot, RecurringTimeslot, TCGCardPrice, AccessCode,
    InventoryDrop, Category, SubCategory, PromoBanner, HomepageSection,
)
from .serializers import (
    ItemSerializer, WantedCardSerializer, PickupSlotSerializer,
    PokeshopSettingsSerializer, PickupTimeslotSerializer, RecurringTimeslotSerializer,
    TCGCardPriceSerializer, AccessCodeSerializer, InventoryDropSerializer,
    CategorySerializer, SubCategorySerializer, PromoBannerSerializer, HomepageSectionSerializer,
)


def _import_result_response_key(result: dict) -> tuple[str, ...]:
    product_id = str(result.get('product_id') or '').strip()
    api_id = str(result.get('api_id') or '').strip()
    if product_id:
        return ('product', product_id)
    if api_id:
        return ('api', api_id)

    normalized_market = str(result.get('market_price') or '').strip()
    return (
        'card',
        _re.sub(r'\W+', ' ', str(result.get('name') or '').lower()).strip(),
        _re.sub(r'\W+', ' ', str(result.get('set_name') or '').lower()).strip(),
        _re.sub(r'\W+', '', str(result.get('number') or '').lower()),
        _re.sub(r'\W+', ' ', str(result.get('tcg_subtypes') or result.get('sub_type_name') or '').lower()).strip(),
        normalized_market,
    )


def _import_result_priority(result: dict) -> tuple[int, int, int, int]:
    price_source = str(result.get('price_source') or '')
    return (
        1 if result.get('market_price') is not None else 0,
        1 if price_source.startswith('Trade Database') else 0,
        1 if result.get('tcgplayer_url') else 0,
        1 if result.get('image_small') or result.get('image_large') else 0,
    )


def _dedupe_import_results_for_response(results: list[dict]) -> list[dict]:
    deduped: dict[tuple[str, ...], dict] = {}
    ordered_keys: list[tuple[str, ...]] = []

    for result in results:
        key = _import_result_response_key(result)
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = result
            ordered_keys.append(key)
            continue
        if _import_result_priority(result) > _import_result_priority(existing):
            deduped[key] = result

    return [deduped[key] for key in ordered_keys]


def _coerce_tcg_result_limit(raw_limit, *, default: int = 20, max_limit: int = 50) -> int:
    try:
        parsed_limit = int(raw_limit)
    except (TypeError, ValueError):
        parsed_limit = default
    return max(1, min(parsed_limit, max_limit))


def _serialize_tcg_card_result(result: dict) -> dict:
    market_price = result.get('market_price')
    card_subtypes = result.get('tcg_subtypes') or result.get('subtypes') or ''
    subtypes = result.get('tcg_price_sub_type') or result.get('sub_type_name') or card_subtypes or ''
    if isinstance(subtypes, list):
        sub_type_name = ', '.join(str(value) for value in subtypes if value) or 'Normal'
    else:
        sub_type_name = str(subtypes or 'Normal')

    name = str(result.get('name') or '')
    clean_name = str(result.get('clean_name') or name)
    set_name = str(result.get('set_name') or result.get('group_name') or '')
    image_small = str(result.get('image_small') or result.get('image_url') or result.get('image_large') or '')
    image_large = str(result.get('image_large') or result.get('image_url') or image_small)
    card_number = str(result.get('card_number') or result.get('number') or '')
    set_printed_total = str(result.get('set_printed_total') or '')

    return {
        'product_id': result.get('product_id'),
        'api_id': str(result.get('api_id') or ''),
        'name': name,
        'clean_name': clean_name,
        'group_name': set_name,
        'set_name': set_name,
        'set_id': str(result.get('set_id') or ''),
        'sub_type_name': sub_type_name,
        'tcg_subtypes': sub_type_name,
        'tcg_card_subtypes': ', '.join(card_subtypes) if isinstance(card_subtypes, list) else str(card_subtypes or ''),
        'rarity': str(result.get('rarity') or ''),
        'market_price': str(market_price) if market_price is not None else None,
        'image_url': image_small or image_large,
        'image_small': image_small,
        'image_large': image_large,
        'card_number': card_number,
        'number': card_number,
        'set_printed_total': set_printed_total,
        'tcgplayer_url': str(result.get('tcgplayer_url') or ''),
        'price_source': str(result.get('price_source') or ''),
        'tcg_type': str(result.get('tcg_type') or ''),
        'tcg_stage': str(result.get('tcg_stage') or ''),
        'rarity_type': str(result.get('rarity_type') or ''),
        'tcg_supertype': str(result.get('tcg_supertype') or result.get('supertype') or ''),
        'tcg_hp': result.get('tcg_hp'),
        'tcg_artist': str(result.get('tcg_artist') or ''),
        'set_release_date': str(result.get('set_release_date') or ''),
        'regulation_mark': str(result.get('regulation_mark') or ''),
        'standard_legal': bool(result.get('standard_legal')) if result.get('standard_legal') is not None else None,
        'tcg_legalities': result.get('tcg_legalities') or {},
        'tcg_price_sub_type': sub_type_name,
        'short_description': str(result.get('short_description') or name),
    }


def _get_canonical_tcg_card_results(query: str, *, raise_on_error: bool = False) -> list[dict]:
    normalized_query = ' '.join(query.lower().split())
    cache_fragment = _re.sub(r'[^a-z0-9_.-]+', '_', normalized_query)
    cache_key = f'tcg_card_results:{cache_fragment}'
    cached_results = cache.get(cache_key)
    if cached_results is not None:
        return cached_results

    from .services import fetch_tcg_card

    try:
        import_results = fetch_tcg_card(query)
    except (RuntimeError, RequestsRequestException) as exc:
        if raise_on_error:
            raise
        logger.warning('TCG card search unavailable for query %r: %s', query, exc)
        return []
    except Exception as exc:
        logger.warning('TCG card search failed for query %r: %s', query, exc)
        if raise_on_error:
            raise RuntimeError('Card search is temporarily unavailable.') from exc
        return []

    serialized_results = [
        _serialize_tcg_card_result(result)
        for result in _dedupe_import_results_for_response(import_results)
    ]
    cache.set(cache_key, serialized_results, 60 * 60 * 6)
    return serialized_results


def _get_local_tcg_card_results(query: str, *, limit: int = 50) -> list[dict]:
    normalized_query = ' '.join(query.lower().split())
    cache_fragment = _re.sub(r'[^a-z0-9_.-]+', '_', normalized_query)
    cache_key = f'tcg_card_results:local:{cache_fragment}'
    cached_results = cache.get(cache_key)
    if cached_results is not None:
        return cached_results[:limit]

    from .services import _build_trade_database_import_result, _search_trade_database_candidates

    candidate_limit = max(limit, 50)
    import_results = [
        _build_trade_database_import_result(candidate, 'Trade Database Search')
        for candidate in _search_trade_database_candidates(query, limit=candidate_limit)[:candidate_limit]
    ]
    serialized_results = [
        _serialize_tcg_card_result(result)
        for result in _dedupe_import_results_for_response(import_results)
    ]
    cache.set(cache_key, serialized_results, 60 * 60 * 6)
    return serialized_results[:limit]


def _normalize_card_lookup_text(value: str) -> str:
    return _re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower()).strip()


def _normalize_card_lookup_compact(value: str) -> str:
    return _re.sub(r'[^a-z0-9]+', '', str(value or '').lower()).lstrip('0')


def _card_number_lookup_values(value: str, printed_total: str = '') -> set[str]:
    raw = str(value or '').strip()
    total = str(printed_total or '').strip()
    values = {raw}
    if '/' in raw:
        first, rest = raw.split('/', 1)
        values.update({first.strip(), rest.strip(), f'{first.strip()}/{rest.strip()}'})
    if raw and total:
        values.add(f'{raw}/{total}')

    normalized_values = set()
    for candidate in values:
        compact = _normalize_card_lookup_compact(candidate)
        if compact:
            normalized_values.add(compact)
        digits = _re.sub(r'\D+', '', candidate)
        if digits:
            normalized_values.add(digits.lstrip('0') or digits)
    return normalized_values


def _find_inventory_item_by_exact_card_metadata(card: dict, *, normalized_subtype: str = ''):
    name = str(card.get('name') or card.get('clean_name') or '').strip()
    clean_name = str(card.get('clean_name') or name).strip()
    set_name = str(card.get('set_name') or card.get('group_name') or '').strip()
    card_number = str(card.get('card_number') or card.get('number') or '').strip()
    printed_total = str(card.get('set_printed_total') or '').strip()
    if not name or not set_name or not card_number:
        return None

    normalized_names = {_normalize_card_lookup_text(name), _normalize_card_lookup_text(clean_name)}
    normalized_names.discard('')
    normalized_set = _normalize_card_lookup_text(set_name)
    result_number_values = _card_number_lookup_values(card_number, printed_total)
    if not normalized_names or not normalized_set or not result_number_values:
        return None

    queryset = Item.objects.select_related('category').all()
    cards_category = Category.objects.filter(slug='cards').first()
    if cards_category:
        queryset = queryset.filter(category=cards_category)

    name_tokens = [token for token in _normalize_card_lookup_text(clean_name or name).split() if len(token) >= 2][:4]
    for token in name_tokens:
        queryset = queryset.filter(title__icontains=token)

    matches = []
    for item in queryset.order_by('-id')[:50]:
        item_title = _normalize_card_lookup_text(item.title)
        if item_title not in normalized_names:
            continue

        item_set = _normalize_card_lookup_text(item.tcg_set_name or '')
        if item_set != normalized_set:
            continue

        item_number_values = _card_number_lookup_values(item.card_number or '')
        if not item_number_values.intersection(result_number_values):
            continue

        if normalized_subtype:
            item_subtype = _normalize_card_lookup_compact(item.tcg_subtypes or '')
            if item_subtype and normalized_subtype not in item_subtype:
                continue

        matches.append(item)

    return matches[0] if len(matches) == 1 else None


def _find_inventory_item_for_tcg_card(card: dict):
    api_id = str(card.get('api_id') or '').strip()
    if api_id:
        exact_match = Item.objects.select_related('category').filter(api_id=api_id).order_by('-id').first()
        if exact_match:
            return exact_match

    product_id = str(card.get('product_id') or '').strip()
    sub_type_name = str(card.get('sub_type_name') or card.get('tcg_price_sub_type') or card.get('tcg_subtypes') or '').strip()
    normalized_subtype = _normalize_card_lookup_compact(sub_type_name)
    if product_id:
        product_matches = list(
            Item.objects.select_related('category')
            .filter(api_id__startswith=f'trade-{product_id}-')
            .order_by('-id')[:20]
        )
        if len(product_matches) == 1:
            return product_matches[0]
        for item in product_matches:
            if normalized_subtype and normalized_subtype in _normalize_card_lookup_compact(item.tcg_subtypes or ''):
                return item
        return _find_inventory_item_by_exact_card_metadata(card, normalized_subtype=normalized_subtype)

    if api_id:
        return _find_inventory_item_by_exact_card_metadata(card, normalized_subtype=normalized_subtype)

    name = str(card.get('name') or card.get('clean_name') or '').strip()
    clean_name = str(card.get('clean_name') or name).strip()
    set_name = str(card.get('set_name') or card.get('group_name') or '').strip()
    card_number = str(card.get('card_number') or card.get('number') or '').strip()
    printed_total = str(card.get('set_printed_total') or '').strip()
    if not name:
        return None

    queryset = Item.objects.select_related('category').all()
    cards_category = Category.objects.filter(slug='cards').first()
    if cards_category:
        queryset = queryset.filter(category=cards_category)

    name_tokens = [token for token in _normalize_card_lookup_text(clean_name or name).split() if len(token) >= 2][:4]
    for token in name_tokens:
        queryset = queryset.filter(title__icontains=token)

    set_tokens = [token for token in _normalize_card_lookup_text(set_name).split() if len(token) >= 3][:3]
    if set_tokens:
        set_filter = Q()
        for token in set_tokens:
            set_filter |= Q(tcg_set_name__icontains=token)
        queryset = queryset.filter(set_filter)

    result_number_values = _card_number_lookup_values(card_number, printed_total)
    normalized_names = {_normalize_card_lookup_text(name), _normalize_card_lookup_text(clean_name)}
    normalized_set = _normalize_card_lookup_text(set_name)

    best_item = None
    best_score = 0
    for item in queryset.order_by('-id')[:50]:
        score = 0
        item_title = _normalize_card_lookup_text(item.title)
        if item_title in normalized_names:
            score += 80
        elif any(item_title and normalized_name and item_title in normalized_name for normalized_name in normalized_names):
            score += 45

        item_set = _normalize_card_lookup_text(item.tcg_set_name or '')
        if normalized_set and item_set:
            if item_set == normalized_set:
                score += 45
            elif item_set in normalized_set or normalized_set in item_set:
                score += 30

        if result_number_values:
            item_number_values = _card_number_lookup_values(item.card_number or '')
            if item_number_values and item_number_values.intersection(result_number_values):
                score += 45
            elif item_number_values:
                score -= 80

        if normalized_subtype and normalized_subtype in _normalize_card_lookup_compact(item.tcg_subtypes or ''):
            score += 15

        if score > best_score:
            best_item = item
            best_score = score

    return best_item if best_score >= 95 else None


ADMIN_CARD_SYNC_FIELDS = {
    'api_id': {'label': 'API ID', 'source': 'api_id'},
    'tcg_set_name': {'label': 'Set', 'source': 'set_name'},
    'card_number': {'label': 'Card Number', 'source': 'card_number'},
    'rarity': {'label': 'Printed Rarity', 'source': 'rarity'},
    'rarity_type': {'label': 'Rarity Group', 'source': 'rarity_type'},
    'tcg_supertype': {'label': 'Supertype', 'source': 'tcg_supertype'},
    'tcg_type': {'label': 'Type', 'source': 'tcg_type'},
    'tcg_stage': {'label': 'Stage', 'source': 'tcg_stage'},
    'tcg_subtypes': {'label': 'Card Traits', 'source': 'tcg_subtypes'},
    'tcg_hp': {'label': 'HP', 'source': 'tcg_hp'},
    'tcg_artist': {'label': 'Artist', 'source': 'tcg_artist'},
    'tcg_set_release_date': {'label': 'Release Date', 'source': 'set_release_date'},
    'regulation_mark': {'label': 'Regulation Mark', 'source': 'regulation_mark'},
    'standard_legal': {'label': 'Standard Legal', 'source': 'standard_legal'},
    'tcg_legalities': {'label': 'Legalities', 'source': 'tcg_legalities'},
}


def _request_values(params, key: str) -> list[str]:
    if hasattr(params, 'getlist'):
        values = params.getlist(key)
    else:
        raw_value = params.get(key) if isinstance(params, dict) else None
        if raw_value is None:
            values = []
        elif isinstance(raw_value, list):
            values = raw_value
        else:
            values = [raw_value]
    return [str(value).strip() for value in values if str(value).strip()]


def _request_value(params, key: str, default: str = '') -> str:
    values = _request_values(params, key)
    return values[0] if values else default


def _admin_card_base_queryset():
    qs = Item.objects.select_related('category', 'subcategory').prefetch_related(
        'images', 'tags', 'scheduled_drops'
    )
    cards_category = Category.objects.filter(slug='cards').first()
    if cards_category:
        return qs.filter(category=cards_category)
    return qs.filter(category__slug='cards')


def _admin_cards_queryset_from_params(params):
    qs = _admin_card_base_queryset()

    q = _request_value(params, 'q') or _request_value(params, 'search')
    if q:
        qs = qs.filter(
            Q(title__icontains=q) |
            Q(short_description__icontains=q) |
            Q(tcg_set_name__icontains=q) |
            Q(card_number__icontains=q) |
            Q(api_id__icontains=q) |
            Q(rarity__icontains=q) |
            Q(tcg_type__icontains=q) |
            Q(tcg_stage__icontains=q) |
            Q(tcg_supertype__icontains=q) |
            Q(tcg_subtypes__icontains=q) |
            Q(regulation_mark__icontains=q) |
            Q(tcg_artist__icontains=q)
        )

    exact_filters = {
        'tcg_type': 'tcg_type__in',
        'tcg_stage': 'tcg_stage__in',
        'tcg_supertype': 'tcg_supertype__in',
        'rarity': 'rarity__in',
        'regulation_mark': 'regulation_mark__in',
        'tcg_set_name': 'tcg_set_name__in',
        'tcg_artist': 'tcg_artist__in',
    }
    for param_key, lookup in exact_filters.items():
        values = _request_values(params, param_key)
        if values:
            if param_key == 'regulation_mark':
                values = [value.upper() for value in values]
            qs = qs.filter(**{lookup: values})

    stock = _request_value(params, 'stock')
    in_stock = _request_value(params, 'in_stock').lower()
    if stock == 'in_stock' or in_stock in {'1', 'true', 'yes', 'on'}:
        qs = qs.filter(stock__gt=0)
    elif stock == 'out_of_stock':
        qs = qs.filter(stock__lte=0)

    status_filter = _request_value(params, 'status')
    if status_filter == 'active':
        qs = qs.filter(is_active=True)
    elif status_filter == 'inactive':
        qs = qs.filter(is_active=False)

    standard_legal = _request_value(params, 'standard_legal').lower()
    if standard_legal in {'1', 'true', 'yes', 'legal'}:
        qs = qs.filter(standard_legal=True)
    elif standard_legal in {'0', 'false', 'no', 'not_legal'}:
        qs = qs.filter(standard_legal=False)
    elif standard_legal == 'unknown':
        qs = qs.filter(standard_legal__isnull=True)

    for missing_field in _request_values(params, 'missing'):
        if missing_field == 'regulation_mark':
            qs = qs.filter(Q(regulation_mark__isnull=True) | Q(regulation_mark=''))
        elif missing_field == 'tcg_type':
            qs = qs.filter(Q(tcg_type__isnull=True) | Q(tcg_type=''))
        elif missing_field == 'tcg_hp':
            qs = qs.filter(tcg_hp__isnull=True)
        elif missing_field == 'standard_legal':
            qs = qs.filter(standard_legal__isnull=True)
        elif missing_field == 'api_id':
            qs = qs.filter(Q(api_id__isnull=True) | Q(api_id=''))
        elif missing_field == 'rarity':
            qs = qs.filter(Q(rarity__isnull=True) | Q(rarity=''))

    sort = _request_value(params, 'sort')
    if sort == 'name':
        return qs.order_by('title', 'id').distinct()
    if sort == 'release-desc':
        return qs.order_by('-tcg_set_release_date', 'title').distinct()
    if sort == 'release-asc':
        return qs.order_by('tcg_set_release_date', 'title').distinct()
    if sort == 'stock-low':
        return qs.order_by('stock', 'title').distinct()
    if sort == 'missing-first':
        return qs.order_by('regulation_mark', 'tcg_type', 'tcg_hp', 'title').distinct()
    return qs.order_by('-id').distinct()


def _admin_card_facets():
    qs = _admin_card_base_queryset()

    def distinct_values(field: str) -> list[str]:
        return list(
            qs.exclude(**{f'{field}__isnull': True}).exclude(**{field: ''})
            .values_list(field, flat=True).distinct().order_by(field)
        )

    return {
        'tcg_types': distinct_values('tcg_type'),
        'tcg_stages': distinct_values('tcg_stage'),
        'tcg_supertypes': distinct_values('tcg_supertype'),
        'printed_rarities': distinct_values('rarity'),
        'regulation_marks': distinct_values('regulation_mark'),
        'sets': distinct_values('tcg_set_name'),
        'artists': distinct_values('tcg_artist'),
    }


def _sync_card_search_queries(item: Item) -> list[str]:
    queries = []
    full_metadata = ' '.join(
        value for value in [item.title, item.tcg_set_name or '', item.card_number or ''] if value
    ).strip()
    if full_metadata:
        queries.append(full_metadata)
    title_and_set = ' '.join(value for value in [item.title, item.tcg_set_name or ''] if value).strip()
    if title_and_set:
        queries.append(title_and_set)
    if item.title:
        queries.append(item.title)

    deduped = []
    seen = set()
    for query in queries:
        normalized = _normalize_card_lookup_text(query)
        if normalized and normalized not in seen:
            seen.add(normalized)
            deduped.append(query)
    return deduped


def _sync_candidate_score(item: Item, card: dict) -> int:
    score = 0
    item_api_id = str(item.api_id or '').strip()
    card_api_id = str(card.get('api_id') or '').strip()
    product_id = str(card.get('product_id') or '').strip()

    if item_api_id and card_api_id and item_api_id == card_api_id:
        score += 200
    if item_api_id.startswith('trade-') and product_id and item_api_id.startswith(f'trade-{product_id}-'):
        score += 180

    item_title = _normalize_card_lookup_text(item.title)
    card_names = {
        _normalize_card_lookup_text(card.get('name') or ''),
        _normalize_card_lookup_text(card.get('clean_name') or ''),
    }
    card_names.discard('')
    if item_title and item_title in card_names:
        score += 65
    elif item_title and any(item_title in name or name in item_title for name in card_names):
        score += 35

    item_set = _normalize_card_lookup_text(item.tcg_set_name or '')
    card_set = _normalize_card_lookup_text(card.get('set_name') or card.get('group_name') or '')
    if item_set and card_set:
        if item_set == card_set:
            score += 45
        elif item_set in card_set or card_set in item_set:
            score += 25

    item_numbers = _card_number_lookup_values(item.card_number or '')
    card_numbers = _card_number_lookup_values(
        str(card.get('card_number') or card.get('number') or ''),
        str(card.get('set_printed_total') or ''),
    )
    if item_numbers and card_numbers:
        if item_numbers.intersection(card_numbers):
            score += 55
        else:
            score -= 70

    item_subtypes = _normalize_card_lookup_compact(item.tcg_subtypes or '')
    card_subtypes = _normalize_card_lookup_compact(card.get('tcg_subtypes') or card.get('sub_type_name') or '')
    if item_subtypes and card_subtypes and (item_subtypes in card_subtypes or card_subtypes in item_subtypes):
        score += 10

    return score


def _find_sync_card_for_inventory_item(item: Item):
    best_card = None
    best_score = 0
    seen_keys = set()

    for query in _sync_card_search_queries(item):
        cards = _get_canonical_tcg_card_results(query, raise_on_error=True)
        for card in cards:
            key = _import_result_response_key(card)
            if key in seen_keys:
                continue
            seen_keys.add(key)

            score = _sync_candidate_score(item, card)
            matched_item = _find_inventory_item_for_tcg_card(card)
            if matched_item and matched_item.pk == item.pk:
                score += 80

            if score > best_score:
                best_score = score
                best_card = card

    return best_card if best_score >= 90 else None


_SKIP_SYNC_VALUE = object()


def _coerce_sync_value(field: str, card: dict):
    source_key = ADMIN_CARD_SYNC_FIELDS[field]['source']
    if field == 'card_number':
        value = card.get('card_number') or card.get('number')
    else:
        value = card.get(source_key)

    if field == 'tcg_hp':
        if value in (None, ''):
            return _SKIP_SYNC_VALUE
        try:
            return int(value)
        except (TypeError, ValueError):
            return _SKIP_SYNC_VALUE

    if field == 'standard_legal':
        if value is None:
            return _SKIP_SYNC_VALUE
        return bool(value)

    if field == 'tcg_legalities':
        return value if isinstance(value, dict) and value else _SKIP_SYNC_VALUE

    if field == 'tcg_set_release_date':
        if not value:
            return _SKIP_SYNC_VALUE
        try:
            return _date.fromisoformat(str(value)[:10])
        except ValueError:
            return _SKIP_SYNC_VALUE

    if value in (None, ''):
        return _SKIP_SYNC_VALUE
    value = str(value).strip()
    if field == 'regulation_mark':
        value = value.upper()
    return value or _SKIP_SYNC_VALUE


def _fallback_tcg_sets_from_trade_database() -> list[dict]:
    results = []
    seen_names: set[str] = set()

    for entry in TCGCardPrice.objects.exclude(group_name='').order_by('group_name', 'group_id').values('group_id', 'group_name'):
        raw_name = str(entry['group_name'] or '').strip()
        if not raw_name:
            continue
        normalized_name = raw_name.split(': ', 1)[1].strip() if ': ' in raw_name else raw_name
        normalized_key = normalized_name.lower()
        if not normalized_name or normalized_key in seen_names:
            continue
        seen_names.add(normalized_key)
        results.append({
            'id': f"trade-db-{entry['group_id'] or normalized_key.replace(' ', '-')}",
            'name': normalized_name,
            'series': 'Trade Database',
            'releaseDate': '',
        })

    return results


def _coerce_boolish(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return bool(value)
    normalized = str(value).strip().lower()
    if normalized in {'true', '1', 'yes', 'on'}:
        return True
    if normalized in {'false', '0', 'no', 'off', ''}:
        return False
    return None


def _sealed_item_filter() -> Q:
    return Q(category__slug__in=['boxes', 'sealed']) | Q(category__name__icontains='sealed')


def _apply_homepage_priority_ordering(qs):
    ex_match = Q(title__icontains=' ex ') | Q(title__iendswith=' ex') | Q(rarity__icontains='ex')

    return qs.annotate(
        homepage_priority=Case(
            When(_sealed_item_filter() & Q(stock__gt=0), then=Value(1)),
            When(
                Q(rarity_type='Special Illustration Rare')
                | Q(rarity__icontains='Special Illustration Rare')
                | Q(rarity_type__icontains='Mega Attack Rare')
                | Q(rarity__icontains='Mega Attack Rare'),
                then=Value(2),
            ),
            When(
                Q(rarity_type='Illustration Rare')
                | Q(rarity__icontains='Illustration Rare'),
                then=Value(3),
            ),
            When(ex_match, then=Value(4)),
            default=Value(5),
            output_field=IntegerField(),
        )
    ).order_by('homepage_priority', '-created_at')


def _apply_homepage_sealed_cap(qs, sealed_cap: int):
    if sealed_cap <= 0:
        return qs

    sealed_ids = list(
        qs.filter(_sealed_item_filter(), stock__gt=0).values_list('id', flat=True)[:sealed_cap]
    )
    ordered_ids = list(qs.values_list('id', flat=True))
    if not ordered_ids:
        return qs.none()

    final_ids = sealed_ids + [item_id for item_id in ordered_ids if item_id not in sealed_ids]
    custom_order = Case(
        *[When(id=item_id, then=Value(index)) for index, item_id in enumerate(final_ids)],
        output_field=IntegerField(),
    )
    return qs.filter(id__in=final_ids).order_by(custom_order)


def _save_with_full_clean(serializer):
    from django.db import transaction as db_transaction
    from django.core.exceptions import ValidationError as DjangoValidationError
    from rest_framework.exceptions import ValidationError as DRFValidationError

    try:
        with db_transaction.atomic():
            instance = serializer.save()
            instance.full_clean()
    except DjangoValidationError as e:
        raise DRFValidationError(e.message_dict if hasattr(e, 'message_dict') else e.messages)


class IsStaffOrAdminEmail(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return user.is_staff or user.email.lower() == 'vashukla@ucsc.edu'


import logging as _logging
_logger = _logging.getLogger(__name__)


def _flag_orders_for_deleted_timeslot(lookup: dict, slot_label: str):
    from orders.models import Order
    from orders.services import send_discord_dm
    from django.conf import settings

    RESCHEDULE_DAYS = 3
    deadline = tz.now() + _timedelta(days=RESCHEDULE_DAYS)

    affected = Order.objects.filter(
        status__in=Order.ACTIVE_ORDER_STATUSES,
        **lookup,
    ).select_related('user', 'item')

    for order in affected:
        order.requires_rescheduling = True
        order.reschedule_deadline = deadline
        order.save(update_fields=['requires_rescheduling', 'reschedule_deadline'])

        frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
        send_discord_dm(
            user=order.user,
            title='Timeslot Cancelled - Action Required',
            description=(
                f'Your pickup timeslot **{slot_label}** for order **{order.item.title}** '
                f'has been cancelled by the store. Please select a new timeslot '
                f'before **{deadline.strftime("%b %d, %Y")}** or your order will be cancelled.'
            ),
            color=0xF59E0B,
            url=f'{frontend_url}/orders/{order.order_id}',
            button={'label': 'Reschedule Now', 'url': f'{frontend_url}/orders/{order.order_id}'},
        )
        _logger.info('Flagged order %s for rescheduling (timeslot deleted: %s)', order.pk, slot_label)


def _build_recurring_booking_counts(timeslots, pickup_dates=None):
    from orders.models import Order
    from trade_ins.models import TradeInRequest

    timeslots = list(timeslots)
    if not timeslots:
        return {}

    pickup_dates = pickup_dates or {
        timeslot.id: next_customer_pickup_date_for_timeslot(timeslot)
        for timeslot in timeslots
    }
    booking_filters = Q()
    for timeslot in timeslots:
        booking_filters |= Q(
            recurring_timeslot_id=timeslot.id,
            pickup_date=pickup_dates[timeslot.id],
        )

    counts = {}

    order_rows = Order.objects.filter(
        booking_filters,
        status__in=Order.ACTIVE_SLOT_STATUSES,
    ).values('recurring_timeslot_id', 'pickup_date').annotate(total=Count('id'))
    for row in order_rows:
        key = (row['recurring_timeslot_id'], row['pickup_date'])
        counts[key] = counts.get(key, 0) + row['total']

    trade_rows = TradeInRequest.objects.filter(
        booking_filters,
        status__in=TradeInRequest.ACTIVE_PICKUP_STATUSES,
    ).values('recurring_timeslot_id', 'pickup_date').annotate(total=Count('id'))
    for row in trade_rows:
        key = (row['recurring_timeslot_id'], row['pickup_date'])
        counts[key] = counts.get(key, 0) + row['total']

    return counts


class ItemViewSet(viewsets.ModelViewSet):
    serializer_class = ItemSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    lookup_field = 'slug'

    def get_queryset(self):
        # Process any overdue inventory drops before returning results
        if self.action in ('list', 'retrieve'):
            process_pending_drops()

        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            qs = Item.objects.select_related('category', 'subcategory').prefetch_related(
                'tags', 'images', 'scheduled_drops'
            ).all()
        else:
            qs = Item.objects.select_related('category', 'subcategory').prefetch_related(
                'tags', 'images', 'scheduled_drops'
            ).filter(
                is_active=True
            ).filter(
                Q(stock__gt=0) | Q(show_when_out_of_stock=True)
            ).filter(
                Q(published_at__lte=tz.now()) | Q(preview_before_release=True, published_at__isnull=False)
            )

        params = self.request.query_params

        # Optional storefront filter: show only products currently in stock.
        in_stock_only = params.get('in_stock', '').strip().lower() in {'1', 'true', 'yes', 'on'}
        if in_stock_only:
            qs = qs.filter(stock__gt=0)

        # Category filter by slug (multi-value supported for search: ?category=cards&category=boxes)
        category_slugs = [slug.strip() for slug in params.getlist('category') if slug.strip()]
        if category_slugs:
            qs = qs.filter(category__slug__in=category_slugs)

        # Subcategory filter by slug
        subcategory_slug = params.get('subcategory', '').strip()
        if subcategory_slug:
            qs = qs.filter(subcategory__slug=subcategory_slug)

        # Tag filter by slug (custom categories)
        tag_slugs = [slug.strip() for slug in params.getlist('tag') if slug.strip()]
        if tag_slugs:
            qs = qs.filter(tags__slug__in=tag_slugs)

        # TCG facet filters (multi-value supported: ?tcg_type=Fire&tcg_type=Water)
        tcg_types = params.getlist('tcg_type')
        if tcg_types:
            qs = qs.filter(tcg_type__in=tcg_types)

        tcg_stages = params.getlist('tcg_stage')
        if tcg_stages:
            qs = qs.filter(tcg_stage__in=tcg_stages)

        rarity_types = params.getlist('rarity_type')
        if rarity_types:
            qs = qs.filter(rarity_type__in=rarity_types)

        printed_rarities = [value.strip() for value in params.getlist('rarity') if value.strip()]
        if printed_rarities:
            qs = qs.filter(rarity__in=printed_rarities)

        # Deep TCG facet filters
        tcg_supertypes = params.getlist('tcg_supertype')
        if tcg_supertypes:
            qs = qs.filter(tcg_supertype__in=tcg_supertypes)

        tcg_subtypes = [value.strip() for value in params.getlist('tcg_subtype') if value.strip()]
        for subtype in tcg_subtypes:
            qs = qs.filter(tcg_subtypes__icontains=subtype)

        regulation_marks = [value.strip().upper() for value in params.getlist('regulation_mark') if value.strip()]
        if regulation_marks:
            qs = qs.filter(regulation_mark__in=regulation_marks)

        standard_legal_filter = params.get('standard_legal', '').strip().lower()
        if standard_legal_filter in {'1', 'true', 'yes', 'on'}:
            qs = qs.filter(standard_legal=True)

        tcg_set_names = params.getlist('tcg_set_name')
        if tcg_set_names:
            qs = qs.filter(tcg_set_name__in=tcg_set_names)

        tcg_artists = params.getlist('tcg_artist')
        if tcg_artists:
            qs = qs.filter(tcg_artist__in=tcg_artists)

        # Save queryset before price filters for dynamic price_max
        self._qs_before_price = qs

        # Price range filter
        min_price = params.get('min_price', '').strip()
        max_price = params.get('max_price', '').strip()
        if min_price:
            try:
                qs = qs.filter(price__gte=min_price)
            except Exception:
                pass
        if max_price:
            try:
                qs = qs.filter(price__lte=max_price)
            except Exception:
                pass

        # Full-text search
        q = params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(title__icontains=q) |
                Q(short_description__icontains=q) |
                Q(tcg_set_name__icontains=q) |
                Q(rarity_type__icontains=q) |
                Q(rarity__icontains=q) |
                Q(tcg_type__icontains=q) |
                Q(tcg_supertype__icontains=q) |
                Q(tcg_subtypes__icontains=q) |
                Q(regulation_mark__icontains=q) |
                Q(tcg_artist__icontains=q) |
                Q(tags__name__icontains=q)
            )

        if tag_slugs or q:
            qs = qs.distinct()

        # Sorting
        sort = params.get('sort', '').strip()
        home_feed = params.get('home_feed', '').strip().lower()
        if home_feed in {'new_arrivals', 'all_products'}:
            qs = _apply_homepage_priority_ordering(qs)
            qs = _apply_homepage_sealed_cap(qs, 6 if home_feed == 'new_arrivals' else 8)
        elif sort == 'newest':
            qs = qs.order_by('-created_at')
        elif sort == 'price-low':
            qs = qs.order_by('price')
        elif sort == 'price-high':
            qs = qs.order_by('-price')
        elif sort == 'name':
            qs = qs.order_by('title')
        elif sort == 'release-asc':
            qs = qs.order_by('tcg_set_release_date')
        elif sort == 'release-desc':
            qs = qs.order_by('-tcg_set_release_date')

        return qs

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        qs_before_price = getattr(self, '_qs_before_price', None)
        if qs_before_price is not None:
            agg = qs_before_price.aggregate(price_max=Max('price'))
            response.data['price_max'] = float(agg['price_max'] or 0)
        return response

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

    def perform_update(self, serializer):
        item = serializer.instance
        requested_is_active = None
        requested_show_oos = None
        if 'is_active' in self.request.data:
            requested_is_active = _coerce_boolish(self.request.data.get('is_active'))
        if 'show_when_out_of_stock' in self.request.data:
            requested_show_oos = _coerce_boolish(self.request.data.get('show_when_out_of_stock'))

        logger.info(
            (
                'Item update requested: slug=%s id=%s user_id=%s '
                'validated_data=%s raw_is_active=%s raw_show_when_out_of_stock=%s'
            ),
            getattr(item, 'slug', None),
            getattr(item, 'id', None),
            getattr(getattr(self.request, 'user', None), 'id', None),
            serializer.validated_data,
            self.request.data.get('is_active') if 'is_active' in self.request.data else None,
            self.request.data.get('show_when_out_of_stock') if 'show_when_out_of_stock' in self.request.data else None,
        )

        serializer.save()
        serializer.instance.refresh_from_db()

        # Defensive reconciliation for production-only drift on legacy items.
        # If the client explicitly requested visibility booleans and they were not
        # persisted by serializer.save(), enforce them directly and log the mismatch.
        forced_updates = {}
        if requested_is_active is not None and serializer.instance.is_active != requested_is_active:
            forced_updates['is_active'] = requested_is_active
        if requested_show_oos is not None and serializer.instance.show_when_out_of_stock != requested_show_oos:
            forced_updates['show_when_out_of_stock'] = requested_show_oos

        if forced_updates:
            logger.warning(
                'Item update mismatch detected; forcing fields: slug=%s id=%s forced_updates=%s',
                serializer.instance.slug,
                serializer.instance.id,
                forced_updates,
            )
            Item.objects.filter(pk=serializer.instance.pk).update(**forced_updates)
            serializer.instance.refresh_from_db()

        logger.info(
            'Item update saved: slug=%s id=%s is_active=%s show_when_out_of_stock=%s stock=%s published_at=%s',
            serializer.instance.slug,
            serializer.instance.id,
            serializer.instance.is_active,
            serializer.instance.show_when_out_of_stock,
            serializer.instance.stock,
            serializer.instance.published_at,
        )


class ItemByIdView(generics.RetrieveAPIView):
    """Retrieve a single item by numeric PK (used by checkout / cart)."""
    serializer_class = ItemSerializer

    def get_queryset(self):
        return Item.objects.filter(is_active=True).select_related('category', 'subcategory').prefetch_related(
            'images', 'scheduled_drops', 'tags'
        )


class ItemFacetsView(APIView):
    """Return distinct set names and artists from published items, optionally scoped by category."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        qs = Item.objects.filter(
            is_active=True
        ).filter(
            Q(stock__gt=0) | Q(show_when_out_of_stock=True)
        ).filter(
            Q(published_at__lte=tz.now()) | Q(preview_before_release=True, published_at__isnull=False)
        )
        category_slugs = [s.strip() for s in request.query_params.getlist('category') if s.strip()]
        if category_slugs:
            qs = qs.filter(category__slug__in=category_slugs)

        sets = list(
            qs.exclude(tcg_set_name__isnull=True).exclude(tcg_set_name='')
            .values_list('tcg_set_name', flat=True).distinct().order_by('tcg_set_name')
        )
        artists = list(
            qs.exclude(tcg_artist__isnull=True).exclude(tcg_artist='')
            .values_list('tcg_artist', flat=True).distinct().order_by('tcg_artist')
        )
        printed_rarities = list(
            qs.exclude(rarity__isnull=True).exclude(rarity='')
            .values_list('rarity', flat=True).distinct().order_by('rarity')
        )
        regulation_marks = list(
            qs.exclude(regulation_mark__isnull=True).exclude(regulation_mark='')
            .values_list('regulation_mark', flat=True).distinct().order_by('regulation_mark')
        )
        subtype_values = qs.exclude(tcg_subtypes__isnull=True).exclude(tcg_subtypes='').values_list('tcg_subtypes', flat=True)
        subtypes = sorted({
            subtype.strip()
            for value in subtype_values
            for subtype in str(value).split(',')
            if subtype.strip()
        })
        return Response({
            'sets': sets,
            'artists': artists,
            'printed_rarities': printed_rarities,
            'regulation_marks': regulation_marks,
            'subtypes': subtypes,
        })


class WantedCardViewSet(viewsets.ModelViewSet):
    serializer_class = WantedCardSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_classes = []
    lookup_field = 'slug'

    def get_queryset(self):
        qs = WantedCard.objects.select_related('tcg_card').prefetch_related('images').order_by('-id')
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return qs.all()
        return qs.filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


class PickupSlotViewSet(viewsets.ModelViewSet):
    queryset = PickupSlot.objects.filter(is_claimed=False)
    serializer_class = PickupSlotSerializer

    def get_queryset(self):
        queryset = self.queryset
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return queryset
        now = tz.now()
        return queryset.filter(
            date_time__gt=now,
            date_time__date__gte=minimum_customer_pickup_date(now=now),
        )


class PokeshopSettingsView(viewsets.ViewSet):
    """Singleton settings - GET for anyone, PATCH for admins only."""

    def list(self, request):
        settings_obj = PokeshopSettings.load()
        if (settings_obj.store_announcement
                and settings_obj.announcement_expires_at
                and settings_obj.announcement_expires_at <= tz.now()):
            settings_obj.store_announcement = ''
            settings_obj.announcement_expires_at = None
            settings_obj.save(update_fields=['store_announcement', 'announcement_expires_at'])
        return Response(PokeshopSettingsSerializer(settings_obj).data)

    def partial_update(self, request, pk=None):
        if not (request.user.is_authenticated and (request.user.is_staff or getattr(request.user, 'is_admin', False))):
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        settings_obj = PokeshopSettings.load()
        serializer = PokeshopSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PickupTimeslotViewSet(viewsets.ModelViewSet):
    serializer_class = PickupTimeslotSerializer

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return PickupTimeslot.objects.all()
        now = tz.now()
        return PickupTimeslot.objects.filter(
            is_active=True,
            start__gt=now,
            start__date__gte=minimum_customer_pickup_date(now=now),
        )

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

    def perform_create(self, serializer):
        _save_with_full_clean(serializer)

    def perform_update(self, serializer):
        _save_with_full_clean(serializer)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        _flag_orders_for_deleted_timeslot(
            lookup={'pickup_timeslot': instance},
            slot_label=str(instance),
        )
        return super().destroy(request, *args, **kwargs)


class RecurringTimeslotViewSet(viewsets.ModelViewSet):
    serializer_class = RecurringTimeslotSerializer
    throttle_classes = []

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return RecurringTimeslot.objects.all()
        return RecurringTimeslot.objects.filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

    def perform_create(self, serializer):
        _save_with_full_clean(serializer)

    def perform_update(self, serializer):
        _save_with_full_clean(serializer)

    def _serializer_context_for(self, timeslots):
        context = super().get_serializer_context()
        pickup_dates = {
            timeslot.id: next_customer_pickup_date_for_timeslot(timeslot)
            for timeslot in timeslots
        }
        context['recurring_pickup_dates'] = pickup_dates
        context['recurring_booking_counts'] = _build_recurring_booking_counts(timeslots, pickup_dates=pickup_dates)
        return context

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        page = self.paginate_queryset(queryset)
        timeslots = list(page if page is not None else queryset)
        serializer = self.get_serializer(
            timeslots,
            many=True,
            context=self._serializer_context_for(timeslots),
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(
            instance,
            context=self._serializer_context_for([instance]),
        )
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        _flag_orders_for_deleted_timeslot(
            lookup={'recurring_timeslot': instance},
            slot_label=str(instance),
        )
        return super().destroy(request, *args, **kwargs)


class AccessCodeViewSet(viewsets.ModelViewSet):
    """Admin-only CRUD for access codes."""
    serializer_class = AccessCodeSerializer
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get_queryset(self):
        return AccessCode.objects.all().order_by('-created_at')


class InventoryDropViewSet(viewsets.ModelViewSet):
    """Admin CRUD for scheduled inventory drops."""
    serializer_class = InventoryDropSerializer
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get_queryset(self):
        qs = InventoryDrop.objects.all()
        item_id = self.request.query_params.get('item')
        if item_id:
            qs = qs.filter(item_id=item_id)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_processed:
            return Response({'error': 'Cannot delete an already-processed drop.'}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


def process_pending_drops():
    """Execute all overdue inventory drops atomically."""
    from django.db import transaction
    from django.db.models import F
    now = tz.now()
    pending = InventoryDrop.objects.filter(drop_time__lte=now, is_processed=False).select_related('item')
    for drop in pending:
        with transaction.atomic():
            Item.objects.filter(pk=drop.item_id).update(stock=F('stock') + drop.quantity)
            drop.is_processed = True
            drop.save(update_fields=['is_processed'])


def _round_card_market_price(value: _Decimal) -> _Decimal:
    """Apply pricing workflow rule:
    Sub-dollar cards use 25/50/75 cent tiers; >= $1.00 snaps to half-dollar increments.
    """
    if _Decimal('0.00') < value < _Decimal('1.00'):
        if value >= _Decimal('0.65'):
            return _Decimal('0.75')
        if value >= _Decimal('0.30'):
            return _Decimal('0.50')
        return _Decimal('0.25')
    if value >= _Decimal('1.00'):
        half_steps = (value / _Decimal('0.50')).to_integral_value(rounding=_ROUND_HALF_UP)
        return (half_steps * _Decimal('0.50')).quantize(_Decimal('0.01'))
    return value.quantize(_Decimal('0.01'), rounding=_ROUND_DOWN)


def _resolve_trade_price_entry_for_item(item):
    """Resolve a TCGCardPrice row for a card Item when possible."""
    # For imported trade IDs, use the product id directly.
    if item.api_id and item.api_id.startswith('trade-'):
        parts = item.api_id.split('-')
        if len(parts) > 1 and parts[1].isdigit():
            product_id = int(parts[1])
            qs = TCGCardPrice.objects.filter(product_id=product_id, market_price__isnull=False)
            subtype_hint = (item.tcg_subtypes or '').split(',')[0].strip()
            if subtype_hint:
                subtype_match = qs.filter(sub_type_name__icontains=subtype_hint).order_by('-updated_at').first()
                if subtype_match:
                    return subtype_match
            direct_match = qs.order_by('-updated_at').first()
            if direct_match:
                return direct_match

    # Strict fallback for cards without a usable trade product ID.
    # We require both name tokens and at least one secondary identifier
    # (set name, card number, or subtype hint). Ambiguous multi-price
    # results are rejected and handled as manual review.
    title = (item.title or '').strip()
    if not title:
        return None

    tokens = [
        token for token in _re.split(r'[^a-z0-9]+', title.lower())
        if token and len(token) >= 3
    ][:4]

    qs = TCGCardPrice.objects.filter(market_price__isnull=False)

    secondary_applied = False

    set_name = (item.tcg_set_name or '').strip()
    if set_name:
        qs = qs.filter(group_name__icontains=set_name)
        secondary_applied = True

    card_number = (item.card_number or '').strip()
    if card_number:
        qs = qs.filter(Q(card_number__iexact=card_number) | Q(name__icontains=card_number) | Q(clean_name__icontains=card_number))
        secondary_applied = True

    subtype_hint = (item.tcg_subtypes or '').split(',')[0].strip()
    if subtype_hint:
        qs = qs.filter(sub_type_name__icontains=subtype_hint)
        secondary_applied = True

    if not secondary_applied:
        return None

    for token in tokens:
        qs = qs.filter(clean_name__icontains=token)

    candidates = list(qs.order_by('-updated_at')[:25])
    if not candidates:
        return None

    distinct_prices = {str(row.market_price) for row in candidates if row.market_price is not None}
    if len(distinct_prices) != 1:
        return None

    return candidates[0]


def _build_card_pricing_workflow_data():
    cards_category = Category.objects.filter(slug='cards').first()
    if not cards_category:
        return {'manual_cards': [], 'changes': [], 'updates': []}

    items = Item.objects.filter(category=cards_category).order_by('title')
    manual_cards = []
    changes = []
    updates = []

    for item in items:
        price_entry = _resolve_trade_price_entry_for_item(item)
        if not price_entry or price_entry.market_price is None:
            query = ' '.join([part for part in [item.title, item.tcg_set_name or ''] if part]).strip()
            manual_cards.append({
                'item_id': item.id,
                'slug': item.slug,
                'title': item.title,
                'current_price': str(item.price),
                'set_name': item.tcg_set_name or '',
                'reason': 'Manual card (no import ID)' if not item.api_id else 'No market match found in trade database',
                'tcgplayer_search_url': f'https://www.tcgplayer.com/search/all/product?q={_quote_plus(query)}',
            })
            continue

        market_value = _Decimal(str(price_entry.market_price))
        proposed = _round_card_market_price(market_value)
        current = _Decimal(str(item.price))
        if proposed == current:
            continue

        changes.append({
            'item_id': item.id,
            'slug': item.slug,
            'title': item.title,
            'previous_value': str(current),
            'current_market_value': str(market_value),
            'proposed_new_value': str(proposed),
            'set_name': item.tcg_set_name or '',
            'tcgplayer_url': price_entry.tcgplayer_url or (f'https://www.tcgplayer.com/product/{price_entry.product_id}' if price_entry.product_id else ''),
        })
        updates.append((item, proposed))

    return {
        'manual_cards': manual_cards,
        'changes': changes,
        'updates': updates,
    }


class CardPricingWorkflowPreviewView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get(self, request):
        data = _build_card_pricing_workflow_data()
        return Response({
            'manual_cards': data['manual_cards'],
            'changes': data['changes'],
            'summary': {
                'manual_cards': len(data['manual_cards']),
                'changes': len(data['changes']),
            },
        })


class CardPricingWorkflowApplyView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def post(self, request):
        data = _build_card_pricing_workflow_data()
        updates = data['updates']
        if not updates:
            return Response({'updated': 0, 'message': 'No pricing updates were required.'})

        items_to_update = []
        for item, proposed in updates:
            item.price = proposed
            items_to_update.append(item)

        Item.objects.bulk_update(items_to_update, ['price'])
        return Response({
            'updated': len(items_to_update),
            'manual_cards': len(data['manual_cards']),
            'message': 'Pricing workflow applied successfully.',
        })


class AdminCardsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get(self, request):
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.query_params.get('page_size', 36))
        except (TypeError, ValueError):
            page_size = 36
        page_size = max(1, min(page_size, 60))

        qs = _admin_cards_queryset_from_params(request.query_params)
        total_count = qs.count()
        total_pages = max(1, (total_count + page_size - 1) // page_size)
        if page > total_pages:
            page = total_pages
        start = (page - 1) * page_size
        items = qs[start:start + page_size]

        return Response({
            'count': total_count,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
            'results': ItemSerializer(items, many=True, context={'request': request}).data,
            'facets': _admin_card_facets(),
        })


class AdminCardPropertySyncView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def post(self, request):
        raw_fields = request.data.get('fields') or []
        if not isinstance(raw_fields, list):
            return Response({'error': 'fields must be a list.'}, status=status.HTTP_400_BAD_REQUEST)

        fields = []
        for field in raw_fields:
            field = str(field).strip()
            if field not in ADMIN_CARD_SYNC_FIELDS:
                return Response({'error': f'Unsupported sync field: {field}'}, status=status.HTTP_400_BAD_REQUEST)
            if field not in fields:
                fields.append(field)
        if not fields:
            return Response({'error': 'Choose at least one property to sync.'}, status=status.HTTP_400_BAD_REQUEST)

        item_ids = request.data.get('item_ids') or []
        if item_ids:
            if not isinstance(item_ids, list):
                return Response({'error': 'item_ids must be a list.'}, status=status.HTTP_400_BAD_REQUEST)
            qs = _admin_card_base_queryset().filter(id__in=item_ids).order_by('title')
        else:
            filters = request.data.get('filters') or {}
            if not isinstance(filters, dict):
                return Response({'error': 'filters must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
            qs = _admin_cards_queryset_from_params(filters)

        try:
            limit = int(request.data.get('limit', 250))
        except (TypeError, ValueError):
            limit = 250
        limit = max(1, min(limit, 250))

        total_candidates = qs.count()
        items = list(qs[:limit])
        if total_candidates > limit:
            return Response({
                'error': f'This sync would touch {total_candidates} cards. Narrow the filters or sync at most {limit} at a time.',
                'count': total_candidates,
            }, status=status.HTTP_400_BAD_REQUEST)

        results = []
        updated_items = 0
        matched_items = 0
        skipped_items = 0

        for item in items:
            try:
                card = _find_sync_card_for_inventory_item(item)
            except Exception as exc:
                logger.warning('Admin card property sync lookup failed for item_id=%s: %s', item.id, exc)
                results.append({
                    'item_id': item.id,
                    'slug': item.slug,
                    'title': item.title,
                    'status': 'error',
                    'message': 'Card lookup failed. Try again later.',
                    'updated_fields': [],
                })
                skipped_items += 1
                continue

            if not card:
                results.append({
                    'item_id': item.id,
                    'slug': item.slug,
                    'title': item.title,
                    'status': 'not_matched',
                    'message': 'No confident TCG match found.',
                    'updated_fields': [],
                })
                skipped_items += 1
                continue

            matched_items += 1
            updates = {}
            for field in fields:
                value = _coerce_sync_value(field, card)
                if value is _SKIP_SYNC_VALUE:
                    continue
                if getattr(item, field) != value:
                    updates[field] = value

            if updates:
                for field, value in updates.items():
                    setattr(item, field, value)
                item.save(update_fields=list(updates.keys()))
                item.refresh_from_db()
                updated_items += 1
                result_status = 'updated'
                message = 'Updated selected properties.'
            else:
                result_status = 'unchanged'
                message = 'Selected properties were already current or unavailable from the match.'

            results.append({
                'item_id': item.id,
                'slug': item.slug,
                'title': item.title,
                'status': result_status,
                'message': message,
                'matched_card': {
                    'api_id': card.get('api_id') or '',
                    'name': card.get('name') or '',
                    'set_name': card.get('set_name') or card.get('group_name') or '',
                    'number': card.get('card_number') or card.get('number') or '',
                },
                'updated_fields': list(updates.keys()),
                'item': ItemSerializer(item, context={'request': request}).data,
            })

        return Response({
            'count': total_candidates,
            'processed': len(items),
            'matched': matched_items,
            'updated': updated_items,
            'skipped': skipped_items,
            'fields': fields,
            'results': results,
        })


@api_view(['POST'])
@perm_classes_decorator([permissions.IsAuthenticated, IsStaffOrAdminEmail])
def reorder_images(request, slug):
    """Reorder images for an item. Expects { "order": [imageId1, imageId2, ...] }."""
    item = Item.objects.filter(slug=slug).first()
    if not item:
        return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)
    image_ids = request.data.get('order', [])
    if not isinstance(image_ids, list):
        return Response({'error': 'order must be a list of image IDs'}, status=status.HTTP_400_BAD_REQUEST)
    for position, img_id in enumerate(image_ids):
        ItemImage.objects.filter(id=img_id, item=item).update(position=position)
    return Response({'status': 'ok'})


class TCGCardSearchView(APIView):
    """Search TCG card prices. Public endpoint.
    GET /api/inventory/tcg-search/?q=charizard
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if not q or len(q) < 2:
            return Response({'results': []})

        limit = _coerce_tcg_result_limit(request.query_params.get('limit'), default=20)
        return Response({'results': _get_canonical_tcg_card_results(q)[:limit]})


class AdminTCGInventorySearchView(APIView):
    """Search canonical TCG cards and annotate whether each result is already stocked."""
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if not q or len(q) < 2:
            return Response({'results': []})

        limit = _coerce_tcg_result_limit(request.query_params.get('limit'), default=20)
        results = []
        cards = _get_local_tcg_card_results(q, limit=limit) or _get_canonical_tcg_card_results(q)[:limit]
        for card in cards:
            inventory_item = _find_inventory_item_for_tcg_card(card)
            results.append({
                'card': card,
                'inventory_item': ItemSerializer(inventory_item, context={'request': request}).data if inventory_item else None,
                'exists': inventory_item is not None,
                'action': 'add_stock' if inventory_item else 'add_to_database',
            })
        return Response({'results': results})


# ---------------------------------------------------------------------------
# Category / SubCategory ViewSets (Phase 7)
# ---------------------------------------------------------------------------

class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    lookup_field = 'slug'

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return Category.objects.prefetch_related('subcategories', 'tags').all()
        return Category.objects.prefetch_related('subcategories', 'tags').filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_core:
            return Response({'error': f'"{instance.name}" is a core category and cannot be deleted.'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_core:
            data = request.data
            if 'name' in data and data['name'] != instance.name:
                return Response({'error': 'Core category names cannot be changed.'}, status=status.HTTP_403_FORBIDDEN)
            if 'slug' in data and data['slug'] != instance.slug:
                return Response({'error': 'Core category slugs cannot be changed.'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)


class SubCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = SubCategorySerializer

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return SubCategory.objects.all()
        return SubCategory.objects.filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


# ---------------------------------------------------------------------------
# Promo Banner ViewSet (Phase 8)
# ---------------------------------------------------------------------------

class PromoBannerViewSet(viewsets.ModelViewSet):
    serializer_class = PromoBannerSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return PromoBanner.objects.all()
        return PromoBanner.objects.filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


# ---------------------------------------------------------------------------
# Homepage Section ViewSet (Phase 3 / 26)
# ---------------------------------------------------------------------------

class HomepageSectionViewSet(viewsets.ModelViewSet):
    serializer_class = HomepageSectionSerializer

    def get_queryset(self):
        if self.request.user.is_authenticated and (self.request.user.is_staff or getattr(self.request.user, 'is_admin', False)):
            return HomepageSection.objects.prefetch_related('items', 'items__images', 'banners').all()
        visible_items_qs = Item.objects.filter(
            is_active=True
        ).filter(
            Q(stock__gt=0) | Q(show_when_out_of_stock=True)
        ).filter(
            Q(published_at__lte=tz.now()) | Q(preview_before_release=True, published_at__isnull=False)
        ).prefetch_related('images')
        return HomepageSection.objects.prefetch_related(
            Prefetch('items', queryset=visible_items_qs),
            'banners',
        ).filter(is_active=True)

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsStaffOrAdminEmail()]
        return [permissions.AllowAny()]


# ---------------------------------------------------------------------------
# TCG API Import (Phase 10/11 - pokemontcg.io)
# ---------------------------------------------------------------------------

class TCGImportView(APIView):
    """Search pokemontcg.io for card data.
    GET /api/inventory/tcg-import/?q=charizard
    """
    permission_classes = [permissions.IsAuthenticated, IsStaffOrAdminEmail]

    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response({'error': 'q parameter is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            limit = _coerce_tcg_result_limit(request.query_params.get('limit'), default=30)
            results = _get_canonical_tcg_card_results(q)
            return Response({'results': results[:limit]})
        except Exception as e:
            logger.warning('TCG import search failed for query %r: %s', q, e)
            return Response({'results': [], 'warning': 'Card search is temporarily unavailable.'})


class TCGSetsView(APIView):
    """Return list of all official TCG sets, cached 6 hours.
    GET /api/inventory/tcg-sets/
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        global _SETS_CACHE
        now = _time.time()
        if _SETS_CACHE['data'] is None or now - _SETS_CACHE['ts'] > 21600:
            try:
                resp = _requests.get(
                    'https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=300',
                    timeout=10
                )
                resp.raise_for_status()
                raw = resp.json().get('data', [])
                _SETS_CACHE = {
                    'data': [
                        {'id': s['id'], 'name': s['name'], 'series': s.get('series', ''), 'releaseDate': s.get('releaseDate', '')}
                        for s in raw
                    ],
                    'ts': now,
                }
            except Exception as e:
                fallback_sets = _fallback_tcg_sets_from_trade_database()
                if fallback_sets:
                    _SETS_CACHE = {'data': fallback_sets, 'ts': now}
                else:
                    logger.warning('TCG sets lookup failed and no fallback sets are available: %s', e)
                    _SETS_CACHE = {'data': [], 'ts': now}
        return Response({'results': _SETS_CACHE['data']})
