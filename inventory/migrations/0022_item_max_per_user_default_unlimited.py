from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0021_footer_newsletter_and_recurring_location'),
    ]

    operations = [
        migrations.AlterField(
            model_name='item',
            name='max_per_user',
            field=models.PositiveIntegerField(default=0),
        ),
    ]