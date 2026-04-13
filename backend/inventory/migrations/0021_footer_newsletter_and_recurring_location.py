from django.db import migrations, models


class Migration(migrations.Migration):

	dependencies = [
		('inventory', '0020_itemtag_seed_core_categories'),
	]

	operations = [
		migrations.AddField(
			model_name='pokeshopsettings',
			name='show_footer_newsletter',
			field=models.BooleanField(default=True, help_text='Controls the footer signup block on the storefront'),
		),
		migrations.AddField(
			model_name='recurringtimeslot',
			name='location',
			field=models.CharField(blank=True, default='', max_length=160),
		),
	]