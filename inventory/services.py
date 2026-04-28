import re

import requests
from django.db.models import Q

from .models import TCGCardPrice


# ---------------------------------------------------------------------------
# TCG attribute mappers
# ---------------------------------------------------------------------------

def _map_tcg_type(types: list) -> str:
    """Map first API type to our TCGType choice value."""
    if not types:
        return ''
    return types[0]  # API values already match our choices exactly


def _map_tcg_stage(subtypes: list) -> str:
    """Map API subtypes list to our TCGStage choice value."""
    mapping = {
        'basic':   'Basic',
        'stage 1': 'Stage 1',
        'stage 2': 'Stage 2',
        'mega':    'Mega',
        'break':   'BREAK',
        'vmax':    'VMAX',
        'vstar':   'VSTAR',
        'tera':    'Tera',
        'tera ex': 'Tera',
    }
    for subtype in subtypes:
        key = subtype.lower()
        if key in mapping:
            return mapping[key]
    return ''


def _map_rarity_type(api_rarity: str) -> str:
    """Map pokemontcg.io rarity string to our TCGRarity choice value."""
    r = api_rarity.lower()
    if 'special illustration' in r:
        return 'Special Illustration Rare'
    if 'illustration' in r:
        return 'Illustration Rare'
    if 'gold' in r or 'hyper' in r or 'rainbow' in r:
        return 'Gold Secret Rare'
    if 'secret' in r:
        return 'Gold Secret Rare'
    if 'ultra' in r or 'ex' in r or 'gx' in r or ' v' in r or 'vmax' in r or 'vstar' in r:
        return 'Ultra Rare'
    if 'holo' in r:
        return 'Holo Rare'
    if 'rare' in r:
        return 'Rare'
    if 'uncommon' in r:
        return 'Uncommon'
    if 'common' in r:
        return 'Common'
    return ''


def _extract_market_price(prices: dict):
    """Return best available market price from tcgplayer prices block."""
    preference = ['holofoil', '1stEditionHolofoil', 'reverseHolofoil', 'normal', '1stEditionNormal']
    for variant in preference:
        if variant in prices and prices[variant].get('market'):
            return prices[variant]['market']
    # fallback: first variant with a market price
    for variant_data in prices.values():
        if isinstance(variant_data, dict) and variant_data.get('market'):
            return variant_data['market']
    return None


def _display_trade_card_name(value: str) -> str:
    cleaned = re.sub(r'\s*-\s*[a-z0-9]+/[a-z0-9]+\s*$', '', value or '', flags=re.IGNORECASE)
    return cleaned.strip()


def _display_trade_set_name(value: str) -> str:
    if ':' in (value or ''):
        return value.split(':', 1)[1].strip()
    return (value or '').strip()


def _extract_trade_card_number_parts(*values: str) -> tuple[str, str]:
    patterns = [
        re.compile(r'(\d{1,3})\s*/\s*(\d{1,3})\s*$', re.IGNORECASE),
        re.compile(r'(\d{1,3})\s+(\d{1,3})\s*$', re.IGNORECASE),
    ]
    single_number_patterns = [
        re.compile(r'\((\d{1,3})\)\s*$', re.IGNORECASE),
        re.compile(r'\b(\d{1,3})\s*$', re.IGNORECASE),
    ]

    for value in values:
        text = (value or '').strip()
        if not text:
            continue

        for pattern in patterns:
            match = pattern.search(text)
            if match:
                return match.group(1), match.group(2)

        for pattern in single_number_patterns:
            match = pattern.search(text)
            if match:
                return match.group(1), ''

    return '', ''


def _candidate_number_parts(candidate: TCGCardPrice) -> tuple[str, str]:
    number = str(getattr(candidate, 'card_number', '') or '').strip()
    printed_total = str(getattr(candidate, 'set_printed_total', '') or '').strip()
    if number or printed_total:
        return number, printed_total
    return _extract_trade_card_number_parts(candidate.name or '', candidate.clean_name or '')


def _candidate_tcgplayer_url(candidate: TCGCardPrice) -> str:
    return str(getattr(candidate, 'tcgplayer_url', '') or f'https://www.tcgplayer.com/product/{candidate.product_id}')


def _normalize_lookup_value(value: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', (value or '').lower())


def _normalize_card_number_value(value: str) -> str:
    digits = re.sub(r'\D+', '', value or '')
    return digits.lstrip('0') or digits


def _card_number_lookup_variants(value: str) -> list[str]:
    raw = str(value or '').strip()
    digits = re.sub(r'\D+', '', raw)
    variants = {raw, digits, digits.lstrip('0')}
    if digits and len(digits) <= 3:
        variants.add(digits.zfill(3))
    return [variant for variant in variants if variant]


def _tokenize_lookup_value(value: str) -> list[str]:
    return [token for token in re.split(r'[^a-z0-9]+', (value or '').lower()) if token]


def _build_pokemontcg_search_query(search_query: str) -> str:
    terms = _tokenize_lookup_value(search_query)
    if not terms:
        return ''

    clauses = []
    for term in terms:
        wildcard_term = f'*{term}*'
        field_clauses = [
            f'name:{wildcard_term}',
            f'set.name:{wildcard_term}',
            f'subtypes:{wildcard_term}',
        ]

        if term.isdigit():
            numeric_value = int(term)
            field_clauses.extend([
                f'number:{term}',
                f'set.printedTotal:[{numeric_value} TO {numeric_value}]',
                f'set.total:[{numeric_value} TO {numeric_value}]',
            ])
        else:
            field_clauses.append(f'number:{term}')

        clauses.append(f"({' OR '.join(field_clauses)})")

    return ' AND '.join(clauses)


def _preferred_subtypes(api_rarity: str) -> list[str]:
    rarity = (api_rarity or '').lower()
    if 'reverse' in rarity:
        return ['reverseholofoil', 'normal', 'holofoil']
    if 'holo' in rarity:
        return ['holofoil', 'reverseholofoil', 'normal']
    if any(keyword in rarity for keyword in ('double rare', 'ultra', 'illustration', 'secret', 'hyper')):
        return ['holofoil', 'normal', 'reverseholofoil']
    return ['normal', 'reverseholofoil', 'holofoil']


def _score_trade_candidate(candidate: TCGCardPrice, api_rarity: str) -> tuple[int, float]:
    subtype_rank = _preferred_subtypes(api_rarity)
    subtype = _normalize_lookup_value(candidate.sub_type_name)
    rarity = _normalize_lookup_value(candidate.rarity)
    api_rarity_normalized = _normalize_lookup_value(api_rarity)

    score = 0
    if subtype in subtype_rank:
        score += 30 - (subtype_rank.index(subtype) * 10)
    if api_rarity_normalized and rarity == api_rarity_normalized:
        score += 15

    market_price = float(candidate.market_price) if candidate.market_price is not None else 0.0
    return score, market_price


def _score_trade_search_candidate(candidate: TCGCardPrice, search_query: str) -> tuple[int, float]:
    normalized_query = _normalize_lookup_value(search_query)
    query_tokens = _tokenize_lookup_value(search_query)
    display_name_raw = _display_trade_card_name(candidate.name or candidate.clean_name)
    candidate_name_raw = candidate.clean_name or candidate.name or ''
    set_name_raw = _display_trade_set_name(candidate.group_name)
    display_name = _normalize_lookup_value(display_name_raw)
    candidate_name = _normalize_lookup_value(candidate_name_raw)
    set_name = _normalize_lookup_value(set_name_raw)
    number, printed_total = _candidate_number_parts(candidate)
    normalized_number = _normalize_lookup_value(number)
    normalized_printed_total = _normalize_lookup_value(printed_total)
    normalized_number_combo = _normalize_lookup_value(f'{number}/{printed_total}') if number and printed_total else ''

    display_tokens = (
        set(_tokenize_lookup_value(display_name_raw))
        | set(_tokenize_lookup_value(candidate_name_raw))
        | set(_tokenize_lookup_value(set_name_raw))
    )
    if number:
        display_tokens.add(number.lower())
    if printed_total:
        display_tokens.add(printed_total.lower())
    if number and printed_total:
        display_tokens.add(f'{number.lower()}{printed_total.lower()}')

    score = 0
    if display_name == normalized_query:
        score += 80
    elif display_name.startswith(normalized_query):
        score += 60
    elif normalized_query in display_name:
        score += 40

    if candidate_name.startswith(normalized_query):
        score += 20
    elif normalized_query in candidate_name:
        score += 10

    if set_name == normalized_query:
        score += 35
    elif set_name.startswith(normalized_query):
        score += 20
    elif normalized_query and normalized_query in set_name:
        score += 10

    if normalized_number_combo and normalized_query == normalized_number_combo:
        score += 75
    elif normalized_number and normalized_query == normalized_number:
        score += 55
    elif normalized_printed_total and normalized_query == normalized_printed_total:
        score += 10

    matched_name_tokens = sum(1 for token in query_tokens if token in display_tokens)
    score += matched_name_tokens * 25
    if query_tokens and matched_name_tokens == len(query_tokens):
        score += 40
    elif matched_name_tokens == 0:
        score -= 20

    if 'box' in candidate_name and 'box' not in normalized_query:
        score -= 30
    if 'case' in candidate_name and 'case' not in normalized_query:
        score -= 30

    market_price = float(candidate.market_price) if candidate.market_price is not None else 0.0
    return score, market_price


def _search_trade_database_candidates(search_query: str, limit: int = 120) -> list[TCGCardPrice]:
    terms = _tokenize_lookup_value(search_query)
    if not terms:
        return []

    queryset = TCGCardPrice.objects.filter(market_price__isnull=False)
    for term in terms:
        queryset = queryset.filter(
            Q(clean_name__icontains=term)
            | Q(group_name__icontains=term)
            | Q(name__icontains=term)
            | Q(card_number__icontains=term)
            | Q(set_printed_total__icontains=term)
        )

    candidates = list(queryset[:limit])
    candidates.sort(key=lambda candidate: (_score_trade_search_candidate(candidate, search_query), candidate.updated_at), reverse=True)
    return candidates


def _build_trade_database_import_result(candidate: TCGCardPrice, price_source: str) -> dict:
    display_name = _display_trade_card_name(candidate.name or candidate.clean_name) or candidate.clean_name or candidate.name
    set_name = _display_trade_set_name(candidate.group_name)
    market_price = float(candidate.market_price) if candidate.market_price is not None else None
    subtype = candidate.sub_type_name or ''
    rarity = candidate.rarity or ''
    number, printed_total = _candidate_number_parts(candidate)
    subtype_key = _normalize_lookup_value(subtype) or 'base'
    short_description = candidate.name or display_name
    if number and printed_total:
        short_description = f'{display_name} {number}/{printed_total}'.strip()
    elif number:
        short_description = f'{display_name} {number}'.strip()

    return {
        'api_id': f'trade-{candidate.product_id}-{subtype_key}',
        'product_id': candidate.product_id,
        'name': display_name,
        'set_name': set_name,
        'set_id': '',
        'set_printed_total': printed_total,
        'rarity': rarity,
        'number': number,
        'image_small': candidate.image_url,
        'image_large': candidate.image_url,
        'types': [],
        'supertype': '',
        'subtypes': [subtype] if subtype else [],
        'hp': '',
        'tcgplayer_url': _candidate_tcgplayer_url(candidate),
        'prices': {},
        'market_price': market_price,
        'price_source': price_source if market_price is not None else '',
        'sub_type_name': subtype,
        'tcg_price_sub_type': subtype,
        'tcg_type': '',
        'tcg_stage': '',
        'rarity_type': _map_rarity_type(rarity),
        'tcg_supertype': '',
        'tcg_subtypes': subtype,
        'tcg_hp': None,
        'tcg_artist': '',
        'set_release_date': '',
        'short_description': short_description,
    }


def _extract_tcgplayer_product_id(url: str) -> int | None:
    match = re.search(r'/product/(\d+)', url or '')
    if not match:
        return None
    return int(match.group(1))


def _score_import_result(result: dict, search_query: str) -> tuple[int, float]:
    normalized_query = _normalize_lookup_value(search_query)
    query_tokens = _tokenize_lookup_value(search_query)
    name_raw = str(result.get('name') or '')
    set_name_raw = str(result.get('set_name') or '')
    short_description_raw = str(result.get('short_description') or '')
    number = str(result.get('number') or '')
    printed_total = str(result.get('set_printed_total') or '')
    subtype_raw = str(result.get('tcg_subtypes') or '')

    name = _normalize_lookup_value(name_raw)
    set_name = _normalize_lookup_value(set_name_raw)
    short_description = _normalize_lookup_value(short_description_raw)
    normalized_number = _normalize_lookup_value(number)
    normalized_printed_total = _normalize_lookup_value(printed_total)
    normalized_number_combo = _normalize_lookup_value(f'{number}/{printed_total}') if number and printed_total else ''

    searchable_tokens = (
        set(_tokenize_lookup_value(name_raw))
        | set(_tokenize_lookup_value(set_name_raw))
        | set(_tokenize_lookup_value(short_description_raw))
        | set(_tokenize_lookup_value(subtype_raw))
    )
    if number:
        searchable_tokens.add(number.lower())
    if printed_total:
        searchable_tokens.add(printed_total.lower())
    if number and printed_total:
        searchable_tokens.add(f'{number.lower()}{printed_total.lower()}')

    score = 0
    if name == normalized_query:
        score += 90
    elif name.startswith(normalized_query):
        score += 70
    elif normalized_query and normalized_query in name:
        score += 45

    if set_name == normalized_query:
        score += 35
    elif set_name.startswith(normalized_query):
        score += 20
    elif normalized_query and normalized_query in set_name:
        score += 10

    if short_description.startswith(normalized_query):
        score += 15
    elif normalized_query and normalized_query in short_description:
        score += 8

    if normalized_number_combo and normalized_query == normalized_number_combo:
        score += 75
    elif normalized_number and normalized_query == normalized_number:
        score += 55
    elif normalized_printed_total and normalized_query == normalized_printed_total:
        score += 10

    matched_tokens = sum(1 for token in query_tokens if token in searchable_tokens)
    score += matched_tokens * 20
    if query_tokens and matched_tokens == len(query_tokens):
        score += 35
    elif matched_tokens == 0:
        score -= 25

    lowered_name = name_raw.lower()
    if 'box' in lowered_name and 'box' not in search_query.lower():
        score -= 30
    if 'case' in lowered_name and 'case' not in search_query.lower():
        score -= 30
    if str(result.get('price_source') or '').startswith('Trade Database'):
        score += 5

    market_price = float(result.get('market_price') or 0.0)
    return score, market_price


def _import_result_identity(result: dict) -> tuple[str, str, str, str]:
    return (
        _normalize_lookup_value(str(result.get('name') or '')),
        _normalize_lookup_value(str(result.get('set_name') or '')),
        _normalize_card_number_value(str(result.get('number') or '')),
        _normalize_card_number_value(str(result.get('set_printed_total') or '')),
    )


def _merge_import_results(api_results: list[dict], local_results: list[dict], search_query: str, limit: int = 30) -> list[dict]:
    combined = list(api_results)
    api_identities = {_import_result_identity(result): index for index, result in enumerate(combined)}

    for local_result in local_results:
        identity = _import_result_identity(local_result)
        if identity in api_identities:
            existing_index = api_identities[identity]
            existing_result = combined[existing_index]
            existing_source = str(existing_result.get('price_source') or '')
            if local_result.get('market_price') is not None and existing_source != 'Trade Database':
                existing_result['product_id'] = local_result.get('product_id') or existing_result.get('product_id')
                existing_result['market_price'] = local_result.get('market_price')
                existing_result['price_source'] = local_result.get('price_source')
                existing_result['tcgplayer_url'] = local_result.get('tcgplayer_url')
                existing_result['sub_type_name'] = local_result.get('sub_type_name')
                existing_result['tcg_price_sub_type'] = local_result.get('tcg_price_sub_type')
                if not existing_result.get('image_small'):
                    existing_result['image_small'] = local_result.get('image_small')
                if not existing_result.get('image_large'):
                    existing_result['image_large'] = local_result.get('image_large')
            continue
        api_identities[identity] = len(combined)
        combined.append(local_result)

    return combined[:limit]


def _search_trade_database_fallback(search_query: str) -> list[dict]:
    candidates = _search_trade_database_candidates(search_query)
    if not candidates:
        return []

    results = []
    for candidate in candidates[:12]:
        results.append(_build_trade_database_import_result(candidate, 'Trade Database (Fallback)'))

    return results


def _find_trade_database_match(name: str, set_name: str, api_rarity: str, number: str = '', printed_total: str = ''):
    normalized_name = _normalize_lookup_value(name)
    normalized_set = _normalize_lookup_value(set_name)
    if not normalized_name or not normalized_set:
        return None

    name_tokens = _tokenize_lookup_value(name)
    set_tokens = _tokenize_lookup_value(set_name)
    normalized_number = _normalize_card_number_value(number)
    normalized_printed_total = _normalize_card_number_value(printed_total)
    number_variants = _card_number_lookup_variants(number)

    queryset = TCGCardPrice.objects.filter(market_price__isnull=False)
    for token in set_tokens[:3]:
        queryset = queryset.filter(group_name__icontains=token)

    for token in name_tokens[:4]:
        queryset = queryset.filter(clean_name__icontains=token)

    if normalized_number:
        number_filter = Q()
        for number_variant in number_variants:
            number_filter |= Q(card_number__iexact=number_variant) | Q(name__icontains=number_variant) | Q(clean_name__icontains=number_variant)
        queryset = queryset.filter(number_filter)

    candidates = []
    for candidate in queryset.order_by('-updated_at')[:40]:
        candidate_group = _normalize_lookup_value(candidate.group_name)
        candidate_name = _normalize_lookup_value(candidate.clean_name or candidate.name)
        candidate_number, candidate_total = _candidate_number_parts(candidate)
        normalized_candidate_number = _normalize_card_number_value(candidate_number)
        normalized_candidate_total = _normalize_card_number_value(candidate_total)

        if normalized_set not in candidate_group:
            continue

        if normalized_name not in candidate_name:
            continue

        if normalized_number and normalized_number not in {normalized_candidate_number, ''} and normalized_number not in candidate_name:
            continue

        if normalized_printed_total and normalized_printed_total not in {normalized_candidate_total, ''} and normalized_printed_total not in candidate_name:
            continue

        candidates.append(candidate)

    if not candidates:
        return None

    candidates.sort(key=lambda candidate: (_score_trade_candidate(candidate, api_rarity), candidate.updated_at), reverse=True)
    return candidates[0]


# ---------------------------------------------------------------------------
# Main fetch + map function
# ---------------------------------------------------------------------------

def fetch_tcg_card(card_name):
    """Fetch card data from pokemontcg.io API.
    Returns a list of card dictionaries with standardized fields, including
    pre-mapped TCG attributes and formatted short description.
    """
    url = 'https://api.pokemontcg.io/v2/cards'
    search_query = _build_pokemontcg_search_query(card_name)
    params = {'q': search_query or f'name:*{card_name}*', 'pageSize': 50}
    try:
        resp = requests.get(url, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        fallback_results = _search_trade_database_fallback(card_name)
        if fallback_results:
            return fallback_results
        raise RuntimeError('Pokemon TCG API is temporarily unavailable, and no trade-database fallback results were found.') from exc

    results = []
    for card in data.get('data', []):
        set_info = card.get('set', {})
        set_id = set_info.get('id', '')
        number = card.get('number', '')
        printed_total = set_info.get('printedTotal', '') or set_info.get('total', '')
        name = card.get('name', '')
        types = card.get('types', [])
        subtypes = card.get('subtypes', [])
        api_rarity = card.get('rarity', '')
        prices = card.get('tcgplayer', {}).get('prices', {})
        market_price = _extract_market_price(prices)
        trade_match = _find_trade_database_match(name, set_info.get('name', ''), api_rarity, number, str(printed_total))
        resolved_market_price = float(trade_match.market_price) if trade_match and trade_match.market_price is not None else market_price
        resolved_tcgplayer_url = (
            _candidate_tcgplayer_url(trade_match)
            if trade_match else card.get('tcgplayer', {}).get('url', '')
        )
        resolved_product_id = trade_match.product_id if trade_match else _extract_tcgplayer_product_id(resolved_tcgplayer_url)
        price_source = 'Trade Database' if trade_match else 'TCGPlayer API'
        price_sub_type = trade_match.sub_type_name if trade_match else ''

        # Format: "Mega Meganium ex 101/217" (no set code)
        short_description = f"{name} {number}/{printed_total}".strip()

        results.append({
            'api_id':            card.get('id', ''),
            'product_id':        resolved_product_id,
            'name':              name,
            'set_name':          set_info.get('name', ''),
            'set_id':            set_id,
            'set_printed_total': str(printed_total),
            'rarity':            api_rarity,
            'number':            number,
            'image_small':       card.get('images', {}).get('small', ''),
            'image_large':       card.get('images', {}).get('large', ''),
            'types':             types,
            'supertype':         card.get('supertype', ''),
            'subtypes':          subtypes,
            'hp':                card.get('hp', ''),
            'tcgplayer_url':     resolved_tcgplayer_url,
            'prices':            prices,
            # Pre-mapped attributes
            'market_price':      resolved_market_price,
            'price_source':      price_source if resolved_market_price is not None else '',
            'sub_type_name':     price_sub_type,
            'tcg_price_sub_type': price_sub_type,
            'tcg_type':          _map_tcg_type(types),
            'tcg_stage':         _map_tcg_stage(subtypes),
            'rarity_type':       _map_rarity_type(api_rarity),
            'tcg_supertype':     card.get('supertype', ''),
            'tcg_subtypes':      ', '.join(subtypes) if subtypes else '',
            'tcg_hp':            int(card['hp']) if card.get('hp') and str(card['hp']).isdigit() else None,
            'tcg_artist':        card.get('artist', ''),
            'set_release_date':  set_info.get('releaseDate', ''),
            'short_description': short_description,
        })

    local_results = []
    for candidate in _search_trade_database_candidates(card_name, limit=24)[:12]:
        local_results.append(_build_trade_database_import_result(candidate, 'Trade Database Search'))

    return _merge_import_results(results, local_results, card_name)
