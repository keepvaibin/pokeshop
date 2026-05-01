from django.db.models import Q


DEFAULT_STANDARD_LEGAL_MARKS = ['H', 'I', 'J']
DEFAULT_STANDARD_ILLEGAL_MARKS = ['G']


def default_standard_legal_marks() -> list[str]:
    return DEFAULT_STANDARD_LEGAL_MARKS.copy()


def default_standard_illegal_marks() -> list[str]:
    return DEFAULT_STANDARD_ILLEGAL_MARKS.copy()


def normalize_regulation_mark(value) -> str:
    return str(value or '').strip().upper()


def clean_regulation_marks(values) -> list[str]:
    if not isinstance(values, list):
        return []

    cleaned = []
    seen = set()
    for value in values:
        mark = normalize_regulation_mark(value)
        if len(mark) != 1 or not mark.isalpha() or mark in seen:
            continue
        seen.add(mark)
        cleaned.append(mark)
    return cleaned


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


def standard_legality_override_for_regulation_mark(regulation_mark: str, settings_obj=None):
    from .models import PokeshopSettings

    normalized = normalize_regulation_mark(regulation_mark)
    if not normalized:
        return None
    settings_obj = settings_obj or PokeshopSettings.load()
    illegal_marks = set(clean_regulation_marks(settings_obj.standard_illegal_marks))
    if normalized in illegal_marks:
        return False
    legal_marks = set(clean_regulation_marks(settings_obj.standard_legal_marks))
    if normalized in legal_marks:
        return True
    return None


def apply_standard_legality_overrides(settings_obj=None) -> dict:
    from .models import Item, PokeshopSettings

    settings_obj = settings_obj or PokeshopSettings.load()
    legal_marks = clean_regulation_marks(settings_obj.standard_legal_marks)
    illegal_marks = clean_regulation_marks(settings_obj.standard_illegal_marks)
    legal_updated = 0
    illegal_updated = 0

    if legal_marks:
        legal_updated = Item.objects.filter(regulation_mark__in=legal_marks).update(standard_legal=True)
    if illegal_marks:
        illegal_updated = Item.objects.filter(regulation_mark__in=illegal_marks).update(standard_legal=False)

    return {
        'legal_marks': legal_marks,
        'illegal_marks': illegal_marks,
        'legal_updated': legal_updated,
        'illegal_updated': illegal_updated,
    }


def available_regulation_marks() -> list[str]:
    from .models import Item

    marks = set(DEFAULT_STANDARD_LEGAL_MARKS + DEFAULT_STANDARD_ILLEGAL_MARKS)
    marks.update(
        mark for mark in Item.objects.exclude(regulation_mark__isnull=True).exclude(regulation_mark='')
        .values_list('regulation_mark', flat=True).distinct()
        if normalize_regulation_mark(mark)
    )
    return sorted(marks)


def available_tcg_set_names() -> list[str]:
    from .models import Item

    return list(
        Item.objects.exclude(tcg_set_name__isnull=True).exclude(tcg_set_name='')
        .values_list('tcg_set_name', flat=True).distinct().order_by('tcg_set_name')
    )