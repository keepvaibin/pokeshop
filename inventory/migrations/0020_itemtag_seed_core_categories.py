from django.db import migrations, models


def seed_core_categories(apps, schema_editor):
    Category = apps.get_model('inventory', 'Category')

    Category.objects.exclude(slug__in=['cards', 'boxes', 'accessories', 'tcg-cards', 'sealed-products']).update(is_core=False)

    core_specs = [
        ('Cards', 'cards', ['tcg-cards']),
        ('Boxes', 'boxes', ['sealed-products']),
        ('Accessories', 'accessories', []),
    ]

    for name, canonical_slug, legacy_slugs in core_specs:
        category = Category.objects.filter(slug=canonical_slug).first()
        if category is None and legacy_slugs:
            category = Category.objects.filter(slug__in=legacy_slugs).order_by('id').first()
        if category is None:
            category = Category.objects.create(name=name, slug=canonical_slug, is_active=True, is_core=True)
            continue

        category.name = name
        category.slug = canonical_slug
        category.is_active = True
        category.is_core = True
        category.save(update_fields=['name', 'slug', 'is_active', 'is_core'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0019_category_is_core'),
    ]

    operations = [
        migrations.CreateModel(
            name='ItemTag',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('slug', models.SlugField(blank=True, max_length=120)),
                ('is_active', models.BooleanField(default=True)),
                ('category', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='tags', to='inventory.category')),
            ],
            options={
                'verbose_name': 'Item Tag',
                'verbose_name_plural': 'Item Tags',
                'ordering': ['name'],
            },
        ),
        migrations.AddField(
            model_name='item',
            name='tags',
            field=models.ManyToManyField(blank=True, related_name='items', to='inventory.itemtag'),
        ),
        migrations.AddConstraint(
            model_name='itemtag',
            constraint=models.UniqueConstraint(fields=('category', 'slug'), name='uniq_itemtag_category_slug'),
        ),
        migrations.RunPython(seed_core_categories, noop_reverse),
    ]