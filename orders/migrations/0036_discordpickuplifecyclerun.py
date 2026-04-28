from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0035_discordroleevent'),
    ]

    operations = [
        migrations.CreateModel(
            name='DiscordPickupLifecycleRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('run_date', models.DateField(db_index=True, unique=True)),
                ('status', models.CharField(choices=[('PROCESSING', 'Processing'), ('COMPLETED', 'Completed'), ('FAILED', 'Failed')], db_index=True, default='PROCESSING', max_length=32)),
                ('last_error', models.TextField(blank=True, default='')),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['-run_date'],
            },
        ),
    ]