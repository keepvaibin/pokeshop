# Widen payment_method/status to max_length=20 and update choices

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0004_order_buy_if_trade_denied"),
    ]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="payment_method",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("venmo", "Venmo"),
                    ("zelle", "Zelle"),
                    ("paypal", "PayPal"),
                    ("trade", "Trade-In"),
                    ("cash_plus_trade", "Cash + Trade Difference"),
                ],
            ),
        ),
        migrations.AlterField(
            model_name="order",
            name="status",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("pending", "Pending"),
                    ("fulfilled", "Fulfilled"),
                    ("cancelled", "Cancelled"),
                    ("cash_needed", "Cash Payment Needed"),
                ],
                default="pending",
            ),
        ),
    ]
