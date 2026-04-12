from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0024_merge_20260412_0143'),
    ]

    operations = [
        migrations.AddField(
            model_name='pokeshopsettings',
            name='last_discord_eod_summary_on',
            field=models.DateField(blank=True, null=True),
        ),
    ]
