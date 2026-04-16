# Backend — Django REST API

Django 6.0.4 + Django REST Framework. Handles inventory, orders, user auth (JWT + Google OAuth + Discord OAuth), and Discord DM notifications.

---

## Requirements

- Python 3.11+
- pip

---

## Local Setup

### 1. Create and activate a virtual environment

```bash
# From the repo root or backend/
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

### 2. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3. Create a `.env` file

Create `backend/.env` with the following keys (all optional in development, required in production):

```env
# Required in production — must be set before DJANGO_DEBUG=False
DJANGO_SECRET_KEY=your-secret-key-here

# Set to False in production
DJANGO_DEBUG=True

# Space-separated list of allowed hosts
DJANGO_ALLOWED_HOSTS=localhost 127.0.0.1

# OAuth
GOOGLE_CLIENT_ID=your-google-client-id
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret
DISCORD_OAUTH_REDIRECT_URI=http://localhost:8000/api/auth/discord/callback/

# Frontend URL (used for redirects)
FRONTEND_URL=http://localhost:3000

# Discord bot DM integration
SCTCG_BOT_API_KEY=your-shared-secret
SCTCG_BOT_DM_URL=http://localhost:8001/send_dm

# CORS / CSRF (space-separated, production only)
CORS_ALLOWED_ORIGINS=http://localhost:3000
CSRF_TRUSTED_ORIGINS=http://localhost:3000

# PostgreSQL (production only — leave unset to use SQLite locally)
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

> **Tip:** A secret key can be generated with:
> ```bash
> python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
> ```

### 4. Run migrations

```bash
python manage.py migrate
```

### 5. Create a superuser (optional)

```bash
python manage.py createsuperuser
```

### 6. Start the development server

```bash
python manage.py runserver
```

The API is now available at `http://localhost:8000`.

---

## Running Tests

```bash
python manage.py test
```

---

## Production Deployment (Azure App Service)

### Startup command

Set the following as the **Startup Command** in Azure portal → App Service → Configuration → General Settings:

```
bash startup.sh
```

`startup.sh` runs `collectstatic`, `migrate`, then starts Gunicorn with 4 workers.

### Required Azure App Settings

| Key | Example value |
|-----|---------------|
| `DJANGO_SECRET_KEY` | `<generated>` |
| `DJANGO_DEBUG` | `False` |
| `DJANGO_ALLOWED_HOSTS` | `your-app.azurewebsites.net your-domain.com` |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` |
| `CORS_ALLOWED_ORIGINS` | `https://your-frontend.azurewebsites.net` |
| `CSRF_TRUSTED_ORIGINS` | `https://your-frontend.azurewebsites.net` |
| `GOOGLE_CLIENT_ID` | `...` |
| `DISCORD_CLIENT_ID` | `...` |
| `DISCORD_CLIENT_SECRET` | `...` |
| `DISCORD_OAUTH_REDIRECT_URI` | `https://your-backend.azurewebsites.net/api/auth/discord/callback/` |
| `FRONTEND_URL` | `https://your-frontend.azurewebsites.net` |
| `SCTCG_BOT_API_KEY` | `...` |
| `SCTCG_BOT_DM_URL` | `http://<vm-private-ip>:8001/send_dm` |

### Static files

WhiteNoise serves static files directly from Gunicorn — no separate CDN or nginx required. `collectstatic` is run automatically by `startup.sh`.

### Database

SQLite is used locally. In production, set `DATABASE_URL` to a PostgreSQL connection string and the app switches automatically. Azure Database for PostgreSQL is recommended.

---

## Project Structure

```
backend/
├── manage.py
├── requirements.txt
├── startup.sh              # Azure App Service startup script
├── pokeshop/               # Django project settings
│   ├── settings.py
│   └── urls.py
├── inventory/              # Products, TCG cards, pricing
├── orders/                 # Orders, checkout, Discord notifications
└── users/                  # Auth — JWT, Google OAuth, Discord OAuth
```
