from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0011_userprofile_trade_credit'),
    ]

    operations = [
        migrations.RenameField(
            model_name='userprofile',
            old_name='trade_credit',
            new_name='trade_credit_balance',
        ),
    ]
