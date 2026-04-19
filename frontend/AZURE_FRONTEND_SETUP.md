# Azure Frontend Deployment Configuration

## Problem
The Next.js app (sctcg-web) is failing to start with error:
```
Error: Cannot find module '/home/site/wwwroot/.next/standalone/server.js'
```

**Root Cause:** Azure is NOT building the application. The workflow ships only source code, but Azure needs to run the build process to create the `.next/standalone/` directory.

---

## Solution: Configure Azure App Service for Build-on-Deploy

### Step 1: Add Environment Variables

Go to **Azure Portal** → **App Services** → **sctcg-web** → **Configuration** → **Application settings**

Click **+ New application setting** and add:

1. **Name:** `SCM_DO_BUILD_DURING_DEPLOYMENT`  
   **Value:** `true`  
   *(Tells Oryx to run npm install and npm run build)*

2. **Name:** `DISABLE_COLLECTSTATIC`  
   **Value:** `1`  
   *(Prevents Python-related warnings, not strictly needed but harmless)*

### Step 2: Update Startup Command

Go to **Configuration** → **General settings**

1. Find the **Startup Command** field
2. Change from:  
   `node .next/standalone/server.js`
   
   To:  
   `cd .next/standalone && node server.js`

   *(Next.js standalone mode requires running from inside the standalone directory)*

### Step 3: Save and Restart

1. Click **Save** at the top
2. Click **Yes** to confirm
3. Wait for the settings to apply
4. Click **Restart** to restart the app

---

## What Happens After Configuration

Once you apply these settings and restart, the next time the app restarts (or a new deployment arrives), Azure will:

1. **Extract** the uploaded source files to `/home/site/wwwroot/`
2. **Detect** `package.json` via Oryx
3. **Run** `npm install` (installs 407 packages natively on Azure)
4. **Run** `npm run build` which:
   - Compiles Next.js (creates `.next/` directory)
   - Runs `npm run postbuild` (our custom script)
   - Copies `.next/static` → `.next/standalone/.next/static`
   - Copies `public/` → `.next/standalone/public`
5. **Start** the app with `cd .next/standalone && node server.js`

You should see in the logs:
- `npm install` completing successfully
- `npm run build` completing successfully  
- `✓ Standalone setup complete!` from our postbuild script
- The server starting without the "Cannot find module" error

---

## Environment Variables Already Configured

These should already exist in your App Service (if not, add them):

- `NEXT_PUBLIC_API_URL` - URL to your Django API (e.g., `https://sctcg-api.azurewebsites.net`)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` - Google OAuth client ID for login
- Any other `NEXT_PUBLIC_*` variables your app needs

---

## Verification

After applying settings and restarting:

1. Watch the **Log stream** in Azure Portal
2. You should see Oryx build logs showing npm install and build
3. Container should stay running (not exit with code 1)
4. Visit your app URL: https://sctcg-web-hzhtcjhgfkgyg4a5.westus3-01.azurewebsites.net
5. The site should load successfully

---

## Why This Is Needed

Our hybrid deployment approach:
- **GitHub Actions:** Ships source code only (no dependencies, no build artifacts)
- **Azure:** Builds the app natively using Oryx (prevents GLIBC and other compatibility issues)

This is the same approach we used for the Django API and it works perfectly for Node.js apps too.

---

## If Issues Persist

Check the deployment logs for:
- `npm install` errors (missing dependencies)
- `npm run build` errors (TypeScript compilation issues)
- `postbuild.js` errors (file copy issues)

All code changes are already committed (commit fb90edc). You just need to apply the Azure settings.
