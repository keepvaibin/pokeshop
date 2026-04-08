# UCSC Pokeshop

A modern Pokémon merchandise retail platform for UCSC students, featuring Google OAuth authentication, multiple payment methods (including trade-in), and admin order dispatch management.

## Development Setup

### Quick Start
Run `start_servers.bat` from the root directory to launch both Django backend (port 8000) and Next.js frontend (port 3000) in separate windows.

### Manual Setup
1. **Backend:**
   ```bash
   cd backend
   python -m venv .venv (if not done)
   .venv\Scripts\activate  # Windows
   # source .venv/bin/activate  # Mac/Linux
   pip install -r requirements.txt
   python manage.py migrate
   python manage.py runserver
   ```

2. **Frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

The app will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

## Key Features

### Authentication
- **Google OAuth**: Sign in with UCSC Google accounts (@ucsc.edu domain restricted)
- Automatic user creation on first login
- JWT token-based auth for API requests

### Payment Methods
- **Venmo**: Direct payment via Venmo
- **Zelle**: Banking app payment
- **PayPal**: PayPal checkout
- **Trade-In**: Exchange Pokémon cards for merchandise value

### Trade-In System
When users select "Trade-In" as payment:
1. They specify the card name and estimated value
2. Admin sees these details in the dispatch dashboard
3. Card is received and verified during pickup
4. Value is credited toward merchandise

### Admin Features
- **Dispatch Dashboard** (`/admin/dispatch`): View pending orders with mobile-optimized UI
- Quick actions: Fulfill Order or Mark No-Show
- Trade-in card details displayed prominently
- Real-time order list updates

## Configuration

### Google OAuth Setup
The Google Client ID is pre-configured for UCSC domain restriction. To update:
- `frontend/.env.local`: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `backend/pokeshop/settings.py`: `GOOGLE_CLIENT_ID`

### CORS Configuration
The backend allows CORS requests from:
- `http://localhost:3000` (Frontend dev)
- `http://localhost:5173` (Vite dev)
- Credentials are enabled for cross-origin requests

If deploying, update `CORS_ALLOWED_ORIGINS` in `backend/pokeshop/settings.py`

### Discord Webhook Integration (Future Enhancement)
To integrate Discord webhooks for order notifications:

1. **Create a Discord Webhook URL** in your server settings
2. **Add to environment variables**:
   ```bash
   # In backend/.env or settings
   DISCORD_WEBHOOK_URL=https://discords.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
   ```
3. **Trigger events**:
   - When an order is created: Send notification to #orders channel
   - When order is fulfilled: Update notification
   - When trade-in card is received: Confirm in #logistics channel

Example webhook payload structure:
```json
{
  "content": "New order #123",
  "embeds": [{
    "title": "Order #123",
    "description": "User: student@ucsc.edu\nItem: Charizard Plush\nPayment: Trade-In (Blastoise VMax - $25)",
    "color": 3447003
  }]
}
```

## Form Validation

All checkout forms validate:
- **Discord Handle**: 2+ characters, alphanumeric + `.`, `#`, `-`
- **Trade Card Value**: Must be > $0
- **All required fields**: Cannot be empty
- **Payment/Delivery**: Must select both methods

## Testing

### Backend Tests
```bash
cd backend
python manage.py test
```

### Frontend Testing
- Use Next.js built-in testing tools
- Manual testing at http://localhost:3000

### Quick Validation Checklist
- [ ] Google Login redirects to home with user profile
- [ ] Adding items to cart works
- [ ] Checkout form validates empty fields
- [ ] Trade-in fields appear only when "Trade-In" selected
- [ ] Discord handle validation rejects invalid formats
- [ ] Admin dispatch shows pending orders
- [ ] Fulfill/No-Show buttons work
- [ ] Trade-in card details visible in dispatch

## Styling & UI

### Design System
- **Colors**: Pokemon Blue (#3b82f6), Yellow (#fbbf24), Red (#ef4444)
- **Components**: Lucide icons, Tailwind CSS
- **Fonts**: System defaults (Inter recommended)
- **Layout**: Mobile-first responsive design

### Key Sections
- **Hero Banner**: Gradient with Pokemon theme
- **Featured Items**: Grid with hover effects and stock indicators
- **Empty States**: Friendly "Coming Soon" messages
- **Forms**: Inline validation with error messages
- **Admin**: Large buttons optimized for mobile

## Troubleshooting

### "API not found" errors
- Ensure backend is running on http://localhost:8000
- Check CORS_ALLOWED_ORIGINS in settings.py
- All frontend API calls use `http://localhost:8000` (not 127.0.0.1)

### Auth token expires
- Refresh tokens valid for 24 hours
- Access tokens valid for 60 minutes
- Logout and re-login if issues persist

### Port already in use
- Backend: Change port in `python manage.py runserver 0.0.0.0:8001`
- Frontend: Change port with `npm run dev -- -p 3001`

## Database

Uses SQLite by default (`backend/db.sqlite3`). For production, migrate to PostgreSQL by updating `DATABASES` in `settings.py`.

## Deployment Notes

Before deploying to production:
1. Set `DEBUG = False` in settings.py
2. Update `ALLOWED_HOSTS` with your domain
3. Update `CORS_ALLOWED_ORIGINS` with production URLs
4. Set environment variables for sensitive keys
5. Use a production database (PostgreSQL recommended)
6. Configure a static file server (WhiteNoise or S3)