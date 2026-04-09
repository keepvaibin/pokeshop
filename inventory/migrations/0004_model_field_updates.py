# Hand-written migration: align DB with updated models.py
# - Item: re-add image_path, widen slug, adjust price
# - ItemImage: rename image_path→image (CharField→ImageField), add position + ordering
# - WantedCard: rename title→name, rename price→estimated_value, add slug, fix description
# - WantedCardImage: rename wanted_card→card, rename image_path→image, add position + ordering

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0003_item_slug"),
    ]

    operations = [
        # ── Item ──────────────────────────────────────────────────
        # Re-add image_path (was removed in 0002, but model still uses it)
        migrations.AddField(
            model_name="item",
            name="image_path",
            field=models.CharField(max_length=500, blank=True, default=""),
            preserve_default=False,
        ),
        # Widen slug max_length 50 → 280
        migrations.AlterField(
            model_name="item",
            name="slug",
            field=models.SlugField(max_length=280, unique=True, blank=True),
        ),
        # Narrow price max_digits 10 → 8
        migrations.AlterField(
            model_name="item",
            name="price",
            field=models.DecimalField(max_digits=8, decimal_places=2, default=0),
        ),

        # ── ItemImage ─────────────────────────────────────────────
        # Rename image_path → image
        migrations.RenameField(
            model_name="itemimage",
            old_name="image_path",
            new_name="image",
        ),
        # Change type from CharField to ImageField
        migrations.AlterField(
            model_name="itemimage",
            name="image",
            field=models.ImageField(upload_to="inventory_images/"),
        ),
        # Add position field
        migrations.AddField(
            model_name="itemimage",
            name="position",
            field=models.PositiveIntegerField(default=0),
        ),
        # Set ordering
        migrations.AlterModelOptions(
            name="itemimage",
            options={"ordering": ["position"]},
        ),

        # ── WantedCard ────────────────────────────────────────────
        # Rename title → name
        migrations.RenameField(
            model_name="wantedcard",
            old_name="title",
            new_name="name",
        ),
        # Rename price → estimated_value
        migrations.RenameField(
            model_name="wantedcard",
            old_name="price",
            new_name="estimated_value",
        ),
        # Adjust estimated_value field params (max_digits 10→8)
        migrations.AlterField(
            model_name="wantedcard",
            name="estimated_value",
            field=models.DecimalField(max_digits=8, decimal_places=2, default=0),
        ),
        # Make description blank=True
        migrations.AlterField(
            model_name="wantedcard",
            name="description",
            field=models.TextField(blank=True),
        ),
        # Add slug field
        migrations.AddField(
            model_name="wantedcard",
            name="slug",
            field=models.SlugField(max_length=280, unique=True, blank=True, default=""),
            preserve_default=False,
        ),

        # ── WantedCardImage ───────────────────────────────────────
        # Rename wanted_card → card
        migrations.RenameField(
            model_name="wantedcardimage",
            old_name="wanted_card",
            new_name="card",
        ),
        # Rename image_path → image
        migrations.RenameField(
            model_name="wantedcardimage",
            old_name="image_path",
            new_name="image",
        ),
        # Change type from CharField to ImageField
        migrations.AlterField(
            model_name="wantedcardimage",
            name="image",
            field=models.ImageField(upload_to="wanted_images/"),
        ),
        # Add position field
        migrations.AddField(
            model_name="wantedcardimage",
            name="position",
            field=models.PositiveIntegerField(default=0),
        ),
        # Set ordering
        migrations.AlterModelOptions(
            name="wantedcardimage",
            options={"ordering": ["position"]},
        ),
    ]
