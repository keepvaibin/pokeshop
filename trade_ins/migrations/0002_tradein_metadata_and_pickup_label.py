from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('trade_ins', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tradeinrequest',
            name='submission_method',
            field=models.CharField(choices=[('in_store_dropoff', 'On Campus Pickup')], max_length=32),
        ),
        migrations.AddField(
            model_name='tradeinrequest',
            name='credit_percentage',
            field=models.DecimalField(decimal_places=2, default=Decimal('85.00'), max_digits=5),
        ),
        migrations.AddField(
            model_name='tradeinitem',
            name='base_market_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='tradeinitem',
            name='image_url',
            field=models.URLField(blank=True, default='', max_length=500),
        ),
        migrations.AddField(
            model_name='tradeinitem',
            name='tcg_product_id',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='tradeinitem',
            name='tcg_sub_type',
            field=models.CharField(blank=True, default='', max_length=80),
        ),
    ]