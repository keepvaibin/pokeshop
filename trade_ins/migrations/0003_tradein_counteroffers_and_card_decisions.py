from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('trade_ins', '0002_tradein_metadata_and_pickup_label'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tradeinrequest',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending_review', 'Pending Review'),
                    ('pending_counteroffer', 'Counteroffer Pending'),
                    ('approved_pending_receipt', 'Approved - Awaiting Cards'),
                    ('completed', 'Completed'),
                    ('rejected', 'Rejected'),
                ],
                db_index=True,
                default='pending_review',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='tradeinrequest',
            name='counteroffer_expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='tradeinrequest',
            name='counteroffer_message',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='tradeinitem',
            name='admin_override_value',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='tradeinitem',
            name='is_accepted',
            field=models.BooleanField(default=None, null=True),
        ),
    ]