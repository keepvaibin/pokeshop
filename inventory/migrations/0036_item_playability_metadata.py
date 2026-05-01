from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0035_tcgcardprice_price_metadata'),
    ]

    operations = [
        migrations.AddField(
            model_name='item',
            name='regulation_mark',
            field=models.CharField(blank=True, db_index=True, help_text='Pokemon TCG regulation mark, e.g. G/H/I', max_length=5, null=True),
        ),
        migrations.AddField(
            model_name='item',
            name='standard_legal',
            field=models.BooleanField(blank=True, db_index=True, help_text='Whether the card API reports this print as Standard legal', null=True),
        ),
        migrations.AddField(
            model_name='item',
            name='tcg_legalities',
            field=models.JSONField(blank=True, default=dict, help_text='Raw Pokemon TCG legality data'),
        ),
    ]