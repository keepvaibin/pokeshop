# sctcgbot — Discord Bot

Discord.py 2.6.4 bot. Handles support tickets, sends order notification DMs to customers, and provides slash commands. Runs as a standalone process — it exposes a small internal HTTP server that the Django backend calls to deliver DMs.

---

## Requirements

- Python 3.11+
- pip

---

## Local Setup

### 1. Create and activate a virtual environment

```bash
# From sctcgbot/
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Create a `.env` file

Create `sctcgbot/.env`:

```env
# Discord bot token (from Discord Developer Portal)
DISCORD_BOT_TOKEN=your-bot-token-here

# Django backend base URL (no trailing slash)
DJANGO_API_BASE_URL=http://localhost:8000

# Shared secret — must match SCTCG_BOT_API_KEY in the Django backend
SCTCG_BOT_API_KEY=your-shared-secret

# Discord guild ID(s) where slash commands are synced (comma-separated)
# Leave unset to sync globally (slower propagation)
DISCORD_GUILD_IDS=123456789012345678

# Optional: category ID for support ticket channels
SUPPORT_CATEGORY_ID=

# Internal HTTP server settings (Django calls this to send DMs)
BOT_INTERNAL_API_HOST=127.0.0.1
BOT_INTERNAL_API_PORT=8001
```

> **SCTCG_BOT_API_KEY** is a shared secret between the bot and Django. Generate one with:
> ```bash
> python -c "import secrets; print(secrets.token_hex(32))"
> ```
> Set the same value as `SCTCG_BOT_API_KEY` in `backend/.env` and `sctcgbot/.env`.

### 4. Start the bot

```bash
python main.py
```

---

## Production Deployment (Azure Ubuntu VM)

The bot runs as a managed process on an Azure B2S Ubuntu VM using PM2.

### Prerequisites on the VM

```bash
# Install Node.js (for PM2)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install Python 3.11+
sudo apt install -y python3.11 python3.11-venv python3-pip
```

### 1. Copy files to the VM

```bash
# From your local machine
scp -r ./sctcgbot azureuser@<vm-ip>:/home/azureuser/sctcgbot
```

### 2. Set up the environment on the VM

```bash
cd /home/azureuser/sctcgbot

# Create venv and install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create .env with production values
nano .env
```

### 3. Update ecosystem.config.js

Edit `ecosystem.config.js` and update the `interpreter` path to the venv:

```js
interpreter: '/home/azureuser/sctcgbot/.venv/bin/python',
```

### 4. Start with PM2

```bash
mkdir -p /home/azureuser/logs

pm2 start ecosystem.config.js

# Save process list so it survives reboots
pm2 save

# Register PM2 as a systemd service (follow the printed command)
pm2 startup
```

### 5. Verify

```bash
pm2 status
pm2 logs sctcg-bot --lines 50
```

### VM Firewall

The bot's internal HTTP server (`BOT_INTERNAL_API_PORT=8001`) should **not** be exposed publicly. In Azure, ensure port 8001 is **not** open in the Network Security Group. Django communicates with the bot over the private VNet or via `localhost` if co-located.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `SCTCG_BOT_API_KEY` | Yes | Shared secret with Django backend |
| `DJANGO_API_BASE_URL` | Yes | Base URL of the Django API |
| `DISCORD_GUILD_IDS` | Recommended | Guild IDs for fast slash command sync |
| `SUPPORT_CATEGORY_ID` | No | Category channel ID for support tickets |
| `BOT_INTERNAL_API_HOST` | No | Host for internal DM server (default: `127.0.0.1`) |
| `BOT_INTERNAL_API_PORT` | No | Port for internal DM server (default: `8001`) |

---

## Project Structure

```
sctcgbot/
├── main.py                 # Bot entry point
├── config.py               # Env var loading via BotSettings dataclass
├── api.py                  # Internal HTTP gateway (receives DM requests from Django)
├── requirements.txt
├── ecosystem.config.js     # PM2 process config for production
└── cogs/
    ├── health.py           # Health check slash command
    ├── support.py          # Support ticket system
    └── tasks.py            # Background tasks
```
