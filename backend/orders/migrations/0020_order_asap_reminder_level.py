from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0019_supportticket'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='asap_reminder_level',
            field=models.PositiveSmallIntegerField(default=0, help_text='Highest automated ASAP reminder sent for this order'),
        ),
    ]
