from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0031_item_preview_before_release'),
    ]

    operations = [
        migrations.AddField(
            model_name='item',
            name='show_when_out_of_stock',
            field=models.BooleanField(
                default=True,
                help_text='If enabled, this item remains visible on the storefront when stock reaches 0.',
            ),
        ),
    ]
