import requests


def fetch_tcg_card(card_name):
    """Fetch card data from pokemontcg.io API.
    Returns a list of card dictionaries with standardized fields.
    """
    url = 'https://api.pokemontcg.io/v2/cards'
    params = {'q': f'name:"{card_name}"', 'pageSize': 20}
    resp = requests.get(url, params=params, timeout=5)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for card in data.get('data', []):
        results.append({
            'api_id': card.get('id', ''),
            'name': card.get('name', ''),
            'set_name': card.get('set', {}).get('name', ''),
            'rarity': card.get('rarity', ''),
            'number': card.get('number', ''),
            'image_small': card.get('images', {}).get('small', ''),
            'image_large': card.get('images', {}).get('large', ''),
            'types': card.get('types', []),
            'supertype': card.get('supertype', ''),
            'subtypes': card.get('subtypes', []),
            'hp': card.get('hp', ''),
            'tcgplayer_url': card.get('tcgplayer', {}).get('url', ''),
            'prices': card.get('tcgplayer', {}).get('prices', {}),
        })
    return results
