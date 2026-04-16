import os
import re
from django.core.management.base import BaseCommand
from users.models import PokemonIcon


REGION_TAGS = re.compile(
    r'[_-](kanto|johto|hoenn|sinnoh|unova|kalos|alola|galar|hisui|paldea)$', re.IGNORECASE
)

REGIONAL_FORM_MAP = {
    '-alolan': 'Alola',
    '-galarian': 'Galar',
    '-hisuian': 'Hisui',
    '-paldean': 'Paldea',
}

REGION_TAG_MAP = {
    '_kanto': 'Kanto',
    '_johto': 'Johto',
    '_hoenn': 'Hoenn',
    '_sinnoh': 'Sinnoh',
    '_unova': 'Unova',
    '_kalos': 'Kalos',
}

GEN_RANGES = [
    (151, 'Kanto'),
    (251, 'Johto'),
    (386, 'Hoenn'),
    (493, 'Sinnoh'),
    (649, 'Unova'),
    (721, 'Kalos'),
    (809, 'Alola'),
    (898, 'Galar'),
    (905, 'Hisui'),
]


def parse_pokemon_file(filename):
    name_part = filename.rsplit('.', 1)[0]
    parts = name_part.split('_', 1)
    if len(parts) < 2:
        return None

    id_str, raw_name = parts
    try:
        pokedex_id = int(id_str)
    except ValueError:
        return None

    raw_lower = raw_name.lower()

    region = None
    for suffix, reg in REGIONAL_FORM_MAP.items():
        if suffix in raw_lower:
            region = reg
            break

    if not region:
        for suffix, reg in REGION_TAG_MAP.items():
            if raw_lower.endswith(suffix.lstrip('_')) and '_' in raw_name:
                last_part = '_' + raw_name.rsplit('_', 1)[-1]
                if last_part.lower() == suffix:
                    region = reg
                    break

    if not region:
        for ceiling, reg in GEN_RANGES:
            if pokedex_id <= ceiling:
                region = reg
                break
        else:
            region = 'Paldea'

    clean_name = REGION_TAGS.sub('', raw_name)
    clean_name = clean_name.replace('-', ' ')
    display_name = ' '.join(w.capitalize() for w in clean_name.split())

    return {
        'pokedex_number': pokedex_id,
        'display_name': display_name,
        'region': region,
        'filename': filename,
    }


class Command(BaseCommand):
    help = 'Seed PokemonIcon table from image files in the pkmn_icons folder'

    def add_arguments(self, parser):
        parser.add_argument(
            '--folder',
            type=str,
            help='Path to the folder containing Pokemon icon PNGs',
        )
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Delete all existing icons before seeding',
        )

    def handle(self, *args, **options):
        folder = options.get('folder')
        if not folder:
            base = os.path.dirname(os.path.dirname(os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            )))
            folder = os.path.join(base, 'frontend', 'public', 'pkmn_icons')
        folder = os.path.normpath(folder)

        if not os.path.isdir(folder):
            self.stderr.write(self.style.ERROR(f'Folder not found: {folder}'))
            return

        if options.get('clear'):
            deleted, _ = PokemonIcon.objects.all().delete()
            self.stdout.write(f'Cleared {deleted} existing icons.')

        files = sorted(f for f in os.listdir(folder) if f.lower().endswith('.png'))
        created = 0
        skipped = 0

        for filename in files:
            parsed = parse_pokemon_file(filename)
            if not parsed:
                self.stderr.write(self.style.WARNING(f'Skipped unparseable file: {filename}'))
                skipped += 1
                continue

            _, was_created = PokemonIcon.objects.get_or_create(
                filename=parsed['filename'],
                defaults={
                    'pokedex_number': parsed['pokedex_number'],
                    'display_name': parsed['display_name'],
                    'region': parsed['region'],
                },
            )
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(self.style.SUCCESS(
            f'Done. Created: {created}, Skipped (existing/unparseable): {skipped}, Total files: {len(files)}'
        ))
