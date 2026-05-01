"""
Management command to seed test products for local development.
Safe to run multiple times — uses get_or_create and update_or_create.

Usage:
    python manage.py seed_test_products
    python manage.py seed_test_products --clear   # wipe all items first
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.utils.text import slugify
from inventory.models import Category, Item


PRODUCTS = [
    # ── CARDS ──────────────────────────────────────────────────────────
    {
        "category_slug": "cards",
        "title": "Charizard ex (Obsidian Flames)",
        "short_description": "The iconic fire dragon in full art ultra-rare glory.",
        "description": "Charizard ex from Scarlet & Violet — Obsidian Flames (SV3). Full Art Ultra Rare. Near Mint condition.",
        "price": "24.99",
        "stock": 5,
        "max_per_user": 2,
        "max_per_week": None,
        "max_total_per_user": 4,
        "tcg_set_name": "Obsidian Flames",
        "rarity": "Ultra Rare",
        "is_holofoil": True,
        "card_number": "125/197",
        "tcg_type": "FIRE",
        "tcg_stage": "STAGE2",
        "rarity_type": "ULTRA",
    },
    {
        "category_slug": "cards",
        "title": "Pikachu ex (Paldea Evolved)",
        "short_description": "The fan-favourite in ex form from Paldea Evolved.",
        "description": "Pikachu ex from Scarlet & Violet — Paldea Evolved (SV2). Full Art. Near Mint condition.",
        "price": "12.49",
        "stock": 8,
        "max_per_user": 0,
        "max_per_week": None,
        "max_total_per_user": None,
        "tcg_set_name": "Paldea Evolved",
        "rarity": "Double Rare",
        "is_holofoil": True,
        "card_number": "71/193",
        "tcg_type": "LIGHTNING",
        "tcg_stage": "BASIC",
        "rarity_type": "DOUBLE_RARE",
    },
    {
        "category_slug": "cards",
        "title": "Mewtwo V (Brilliant Stars)",
        "short_description": "Psychic powerhouse V card in excellent condition.",
        "description": "Mewtwo V from Sword & Shield — Brilliant Stars (SWSH09). Rare Holo V. Near Mint condition.",
        "price": "8.99",
        "stock": 3,
        "max_per_user": 1,
        "max_per_week": 2,
        "max_total_per_user": 2,
        "tcg_set_name": "Brilliant Stars",
        "rarity": "Ultra Rare",
        "is_holofoil": True,
        "card_number": "72/172",
        "tcg_type": "PSYCHIC",
        "tcg_stage": "BASIC",
        "rarity_type": "ULTRA",
    },
    {
        "category_slug": "cards",
        "title": "Gardevoir ex (Scarlet & Violet Base)",
        "short_description": "Psychic-type support powerhouse — currently a top tournament pick.",
        "description": "Gardevoir ex from Scarlet & Violet Base Set. Full Art Ultra Rare. Near Mint / Light Play condition.",
        "price": "15.00",
        "stock": 6,
        "max_per_user": 0,
        "max_per_week": None,
        "max_total_per_user": None,
        "tcg_set_name": "Scarlet & Violet",
        "rarity": "Double Rare",
        "is_holofoil": True,
        "card_number": "86/198",
        "tcg_type": "PSYCHIC",
        "tcg_stage": "STAGE2",
        "rarity_type": "DOUBLE_RARE",
    },
    # ── BOXES ──────────────────────────────────────────────────────────
    {
        "category_slug": "boxes",
        "title": "Obsidian Flames Booster Bundle (6-Pack)",
        "short_description": "6 booster packs from the Obsidian Flames set.",
        "description": "Six booster packs from Pokémon TCG: Scarlet & Violet — Obsidian Flames. Factory sealed.",
        "price": "29.99",
        "stock": 10,
        "max_per_user": 0,
        "max_per_week": None,
        "max_total_per_user": None,
        "tcg_set_name": "Obsidian Flames",
        "rarity": None,
        "is_holofoil": False,
        "card_number": None,
        "tcg_type": None,
        "tcg_stage": None,
        "rarity_type": None,
    },
    {
        "category_slug": "boxes",
        "title": "Paldea Evolved Elite Trainer Box",
        "short_description": "The full ETB experience — 9 packs, sleeves, and accessories.",
        "description": "Pokémon TCG: Scarlet & Violet — Paldea Evolved Elite Trainer Box. Contains 9 booster packs, 65 card sleeves, 45 Energy cards, a player's guide, 6 damage-counter dice, a competition coin, and a storage box. Factory sealed.",
        "price": "49.99",
        "stock": 4,
        "max_per_user": 2,
        "max_per_week": None,
        "max_total_per_user": None,
        "tcg_set_name": "Paldea Evolved",
        "rarity": None,
        "is_holofoil": False,
        "card_number": None,
        "tcg_type": None,
        "tcg_stage": None,
        "rarity_type": None,
    },
    {
        "category_slug": "boxes",
        "title": "Paradox Rift Booster Bundle (6-Pack)",
        "short_description": "6 packs from Paradox Rift — great value pull opportunity.",
        "description": "Six booster packs from Pokémon TCG: Scarlet & Violet — Paradox Rift. Factory sealed.",
        "price": "27.99",
        "stock": 7,
        "max_per_user": 0,
        "max_per_week": None,
        "max_total_per_user": None,
        "tcg_set_name": "Paradox Rift",
        "rarity": None,
        "is_holofoil": False,
        "card_number": None,
        "tcg_type": None,
        "tcg_stage": None,
        "rarity_type": None,
    },
    # ── ACCESSORIES ───────────────────────────────────────────────────
    {
        "category_slug": "accessories",
        "title": "Dragon Shield Perfect Fit Sleeves (100ct)",
        "short_description": "Crystal-clear inner sleeves for double-sleeving your best cards.",
        "description": "Dragon Shield Perfect Fit Sealable — 100 count. Crystal clear inner sleeves ideal for double-sleeving valuable Pokémon cards. Acid-free and archival-quality.",
        "price": "9.99",
        "stock": 15,
        "max_per_user": 0,
        "max_per_week": None,
        "max_total_per_user": None,
        "tcg_set_name": None,
        "rarity": None,
        "is_holofoil": False,
        "card_number": None,
        "tcg_type": None,
        "tcg_stage": None,
        "rarity_type": None,
    },
    {
        "category_slug": "accessories",
        "title": "Ultra Pro Eclipse Matte Sleeves — Jet Black (100ct)",
        "short_description": "Matte black sleeves for a clean competitive look.",
        "description": "Ultra Pro Eclipse Matte sleeves in Jet Black. 100 count. Perfect for tournament play — reduces glare and shuffles smoothly. Acid-free.",
        "price": "11.99",
        "stock": 20,
        "max_per_user": 0,
        "max_per_week": None,
        "max_total_per_user": None,
        "tcg_set_name": None,
        "rarity": None,
        "is_holofoil": False,
        "card_number": None,
        "tcg_type": None,
        "tcg_stage": None,
        "rarity_type": None,
    },
    {
        "category_slug": "accessories",
        "title": "BCW Toploader 35pt (25ct)",
        "short_description": "The standard rigid toploader for protecting your singles.",
        "description": "BCW 35pt rigid toploaders, 25 per pack. Industry-standard protection for standard-size Pokémon TCG cards. Perfect for storing and shipping valuable singles.",
        "price": "4.99",
        "stock": 30,
        "max_per_user": 0,
        "max_per_week": None,
        "max_total_per_user": None,
        "tcg_set_name": None,
        "rarity": None,
        "is_holofoil": False,
        "card_number": None,
        "tcg_type": None,
        "tcg_stage": None,
        "rarity_type": None,
    },
]


class Command(BaseCommand):
    help = "Seed the local database with test products for development."

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete all existing items before seeding.",
        )

    def handle(self, *args, **options):
        if options["clear"]:
            deleted, _ = Item.objects.all().delete()
            self.stdout.write(self.style.WARNING(f"Deleted {deleted} existing items."))

        categories = {c.slug: c for c in Category.objects.all()}
        if not categories:
            self.stdout.write(self.style.ERROR(
                "No categories found. Run migrations first: python manage.py migrate"
            ))
            return

        created_count = 0
        updated_count = 0
        now = timezone.now()

        for product in PRODUCTS:
            cat_slug = product.pop("category_slug")
            category = categories.get(cat_slug)
            if category is None:
                self.stdout.write(self.style.WARNING(
                    f"Category '{cat_slug}' not found — skipping '{product['title']}'"
                ))
                product["category_slug"] = cat_slug  # restore for next run
                continue

            title = product["title"]
            base_slug = slugify(title)
            # Resolve slug uniqueness
            slug = base_slug
            n = 1
            while Item.objects.filter(slug=slug).exclude(title=title).exists():
                slug = f"{base_slug}-{n}"
                n += 1

            obj, created = Item.objects.update_or_create(
                title=title,
                defaults={
                    "slug": slug,
                    "category": category,
                    "is_active": True,
                    "published_at": now,
                    **{k: v for k, v in product.items() if k != "title"},
                },
            )

            product["category_slug"] = cat_slug  # restore for idempotency

            if created:
                created_count += 1
                self.stdout.write(f"  CREATED  {obj.title} (id={obj.id})")
            else:
                updated_count += 1
                self.stdout.write(f"  updated  {obj.title} (id={obj.id})")

        self.stdout.write(self.style.SUCCESS(
            f"\nDone — {created_count} created, {updated_count} updated."
        ))
