# Frontend — Next.js

Next.js 16.2.2 + React 19 + Tailwind CSS 4. Customer-facing storefront and admin dashboard for the SCTCG shop.

---

## Requirements

- Node.js 20+
- npm

---

## Local Setup

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Create a `.env.local` file

Create `frontend/.env.local`:

```env
# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:8000

# Google OAuth client ID (must match the backend's GOOGLE_CLIENT_ID)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
```

### 3. Start the development server

```bash
npm run dev
```

The app is available at `http://localhost:3000`.

---

## Building for Production

```bash
npm run build
```

To start the production server locally after building:

```bash
npm start
```

---

## Production Deployment (Azure App Service)

Azure runs `npm run build` automatically during deployment (Oryx build). Set the **Startup Command** to:

```
npm start
```

### Required Azure App Settings

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://your-backend.azurewebsites.net` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | `...` |

> `NEXT_PUBLIC_` variables are inlined at build time. They must be set as App Settings **before** the build runs.

---

## Linting

```bash
npm run lint
```

---

## Project Structure

```
frontend/
├── package.json
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── app/
│   ├── components/         # Shared UI (Navbar, Footer, etc.)
│   ├── lib/                # API utilities, server fetch helpers
│   ├── orders/             # Order history and receipt pages
│   ├── tcg/                # Product listing and detail pages
│   ├── cart/               # Cart and checkout
│   ├── admin/              # Admin dashboard and dispatch queue
│   └── ...
└── public/                 # Static assets
```
