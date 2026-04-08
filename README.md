# UCSC Pokeshop

## Development Setup

### Quick Start
Run `start_servers.bat` from the root directory to launch both Django backend (port 8000) and Next.js frontend (port 3000) in separate windows.

### Manual Setup
1. **Backend:**
   - cd backend
   - python -m venv .venv (if not done)
   - .venv\Scripts\activate
   - pip install -r requirements.txt
   - python manage.py migrate
   - python manage.py runserver

2. **Frontend:**
   - cd frontend
   - npm install
   - npm run dev

## Google OAuth Setup

The Google Client ID has been configured. If you need to change it, update:
- `frontend/.env.local`: NEXT_PUBLIC_GOOGLE_CLIENT_ID
- `backend/pokeshop/settings.py`: GOOGLE_CLIENT_ID

## Testing

- Backend: `cd backend && python manage.py test`
- Frontend: Built-in Next.js testing (no additional setup required)