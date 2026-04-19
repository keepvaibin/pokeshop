from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0028_pokeshopsettings_ooo_and_orders_disabled'),
    ]

    operations = [
        migrations.AddField(
            model_name='pokeshopsettings',
            name='pay_venmo_enabled',
            field=models.BooleanField(default=True, help_text='Show Venmo as a payment option at checkout'),
        ),
        migrations.AddField(
            model_name='pokeshopsettings',
            name='pay_zelle_enabled',
            field=models.BooleanField(default=True, help_text='Show Zelle as a payment option at checkout'),
        ),
        migrations.AddField(
            model_name='pokeshopsettings',
            name='pay_paypal_enabled',
            field=models.BooleanField(default=True, help_text='Show PayPal as a payment option at checkout'),
        ),
        migrations.AddField(
            model_name='pokeshopsettings',
            name='pay_cash_enabled',
            field=models.BooleanField(default=True, help_text='Show Cash as a payment option at checkout'),
        ),
        migrations.AddField(
            model_name='pokeshopsettings',
            name='pay_trade_enabled',
            field=models.BooleanField(default=True, help_text='Show Trade-In as a payment option at checkout'),
        ),
    ]
