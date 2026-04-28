import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0034_order_store_credit_applied_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='DiscordRoleEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(choices=[('GRANT', 'Grant pickup role'), ('REVOKE', 'Revoke pickup role')], max_length=10)),
                ('discord_id', models.CharField(db_index=True, max_length=32)),
                ('pickup_date', models.DateField(db_index=True)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('PROCESSING', 'Processing'), ('PROCESSED', 'Processed'), ('PROCESSED_IGNORED', 'Processed ignored'), ('PROCESSED_WITH_WARNING', 'Processed with warning'), ('FAILED', 'Failed'), ('DEAD_LETTER', 'Dead letter')], db_index=True, default='PENDING', max_length=32)),
                ('attempt_count', models.PositiveSmallIntegerField(default=0)),
                ('last_error', models.TextField(blank=True, default='')),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('processed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('order', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='discord_role_events', to='orders.order')),
            ],
            options={
                'ordering': ['created_at', 'id'],
                'indexes': [
                    models.Index(fields=['status', 'created_at', 'id'], name='orders_disc_status_6d5737_idx'),
                    models.Index(fields=['discord_id', 'pickup_date', 'status'], name='orders_disc_discord_c3c650_idx'),
                    models.Index(fields=['event_type', 'discord_id', 'pickup_date'], name='orders_disc_event_t_b1089b_idx'),
                ],
            },
        ),
    ]