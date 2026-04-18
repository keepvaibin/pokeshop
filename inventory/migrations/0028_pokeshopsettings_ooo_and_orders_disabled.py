from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0027_item_max_per_week_item_max_total_per_user'),
    ]

    operations = [
        migrations.AddField(
            model_name='pokeshopsettings',
            name='is_ooo',
            field=models.BooleanField(default=False, help_text='Out of Office mode — hides ASAP, timeslots only show after ooo_until date'),
        ),
        migrations.AddField(
            model_name='pokeshopsettings',
            name='ooo_until',
            field=models.DateField(blank=True, null=True, help_text='Date the admin returns (inclusive). Required when is_ooo=True.'),
        ),
        migrations.AddField(
            model_name='pokeshopsettings',
            name='orders_disabled',
            field=models.BooleanField(default=False, help_text='Completely disable all orders (ASAP + scheduled)'),
        ),
    ]
