import requests


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


# ---------------------------------------------------------------------------
# Main fetch + map function
# ---------------------------------------------------------------------------

def fetch_tcg_card(card_name):
    """Fetch card data from pokemontcg.io API.
    Returns a list of card dictionaries with standardized fields, including
    pre-mapped TCG attributes and formatted short description.
    """
    url = 'https://api.pokemontcg.io/v2/cards'
    params = {'q': f'name:"{card_name}"', 'pageSize': 20}
    resp = requests.get(url, params=params, timeout=5)
    resp.raise_for_status()
    data = resp.json()

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

        # Format: "Mega Meganium ex 101/217" (no set code)
        short_description = f"{name} {number}/{printed_total}".strip()

        results.append({
            'api_id':            card.get('id', ''),
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
            'tcgplayer_url':     card.get('tcgplayer', {}).get('url', ''),
            'prices':            prices,
            # Pre-mapped attributes
            'market_price':      market_price,
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
    return results
