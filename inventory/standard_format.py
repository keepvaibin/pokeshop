from django.db.models import Q


def normalize_set_name(value) -> str:
    return ' '.join(str(value or '').split()).casefold()


def clean_set_names(values) -> list[str]:
    if not isinstance(values, list):
        return []

    cleaned = []
    seen = set()
    for value in values:
        name = ' '.join(str(value or '').split())[:100]
        key = normalize_set_name(name)
        if not name or key in seen:
            continue
        seen.add(key)
        cleaned.append(name)
    return cleaned


def set_name_q(names: list[str]) -> Q:
    query = Q(pk__isnull=True)
    for name in names:
        query |= Q(tcg_set_name__iexact=name)
    return query


def standard_legality_override_for_set_name(set_name: str, settings_obj=None):
    from .models import PokeshopSettings

    normalized = normalize_set_name(set_name)
    if not normalized:
        return None
    settings_obj = settings_obj or PokeshopSettings.load()
    illegal_sets = {normalize_set_name(name) for name in clean_set_names(settings_obj.standard_illegal_sets)}
    if normalized in illegal_sets:
        return False
    legal_sets = {normalize_set_name(name) for name in clean_set_names(settings_obj.standard_legal_sets)}
    if normalized in legal_sets:
        return True
    return None


def apply_standard_legality_overrides(settings_obj=None) -> dict:
    from .models import Item, PokeshopSettings

    settings_obj = settings_obj or PokeshopSettings.load()
    legal_sets = clean_set_names(settings_obj.standard_legal_sets)
    illegal_sets = clean_set_names(settings_obj.standard_illegal_sets)
    legal_updated = 0
    illegal_updated = 0

    if legal_sets:
        legal_updated = Item.objects.filter(set_name_q(legal_sets)).update(standard_legal=True)
    if illegal_sets:
        illegal_updated = Item.objects.filter(set_name_q(illegal_sets)).update(standard_legal=False)

    return {
        'legal_sets': legal_sets,
        'illegal_sets': illegal_sets,
        'legal_updated': legal_updated,
        'illegal_updated': illegal_updated,
    }


def available_tcg_set_names() -> list[str]:
    from .models import Item

    return list(
        Item.objects.exclude(tcg_set_name__isnull=True).exclude(tcg_set_name='')
        .values_list('tcg_set_name', flat=True).distinct().order_by('tcg_set_name')
    )