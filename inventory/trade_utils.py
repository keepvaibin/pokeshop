from decimal import Decimal

CONDITION_MULTIPLIERS = {
    'near_mint': Decimal('1.00'),
    'lightly_played': Decimal('0.85'),
    'moderately_played': Decimal('0.70'),
    'heavily_played': Decimal('0.50'),
    'damaged': Decimal('0.30'),
}

# Map legacy 4-tier condition values to the new 5-tier system
LEGACY_CONDITION_MAP = {
    'mint': 'near_mint',
    'good': 'lightly_played',
    'played': 'moderately_played',
    'damaged': 'damaged',
}


def normalize_condition(condition: str) -> str:
    """Normalize a condition value, mapping legacy values to the new 5-tier system."""
    if condition in CONDITION_MULTIPLIERS:
        return condition
    return LEGACY_CONDITION_MAP.get(condition, 'lightly_played')


def calc_trade_credit(base_market_price: Decimal, condition: str, credit_percentage: Decimal) -> Decimal:
    """Calculate trade credit for a card.

    Formula: (base_market_price * condition_multiplier) * (credit_percentage / 100)
    """
    condition = normalize_condition(condition)
    multiplier = CONDITION_MULTIPLIERS.get(condition, Decimal('0.85'))
    condition_adjusted = (base_market_price * multiplier).quantize(Decimal('0.01'))
    credit = (condition_adjusted * (credit_percentage / Decimal('100'))).quantize(Decimal('0.01'))
    return credit
