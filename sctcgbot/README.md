# SCTCG Bot

The Discord bot for the Santa Cruz TCG shop ecosystem, deployed at [santacruztcg.com](https://santacruztcg.com). Built on the [Sonnet-py](https://github.com/Sonnet-Discord/sonnet-py) kernel framework and extended with a native trade-desk integration layer that connects directly to the Django backend API.

---

## Table of Contents

1. [Framework Foundation](#1-framework-foundation)
2. [Native SCTCG Enhancements](#2-native-sctcg-enhancements)
3. [2026 Security and Modernization](#3-2026-security-and-modernization)
4. [Operational Guide](#4-operational-guide)

---

## 1. Framework Foundation

### The Kernel Architecture

Sonnet-py uses a single `discord.Client` instance managed by a central kernel defined in `main.py`. The kernel owns three distinct module directories:

- `cmds/` - Prefix command modules (loaded at startup, reloadable at runtime)
- `libs/` - Shared library modules (auto-reloaded by the kernel before each `cmds/`/`dlibs/` reload)
- `dlibs/` - Dynamic event listener modules (export a `commands` dict mapping event names to async handlers)

When a reload is triggered (via `debug-modules-reload @BotID`), the kernel calls `importlib.reload()` on every module in sequence, then rebuilds the internal dispatch tables. The bot process never restarts. The Discord WebSocket connection stays alive throughout. This is how zero-downtime hot-reloading works for all TCG features - a ticket logic change or heartbeat interval adjustment can be deployed without kicking active users off the gateway.

The SCTCG integration sits entirely in `libs/` and `dlibs/`. No kernel files were modified.

### Kernel RAMFS

Sonnet exposes two in-memory filesystems to every module at runtime:

- `ramfs` - Temporary state, wiped on each reload
- `kernel_ramfs` - Persistent state, survives reloads and reconnects for the lifetime of the process

The SCTCG modules use `kernel_ramfs` to store two critical objects:

**CommandTree** (`sctcg-bridge/tree`)

`discord.app_commands.CommandTree` is the object that discord.py uses to dispatch slash command interactions. If a new tree is created on every reload, the old tree loses its reference in `client._connection._command_tree` and any user mid-interaction gets a silent failure. By storing it in `kernel_ramfs`, the module retrieves the existing tree on reload, re-registers the command functions against it (picking up any code changes), and the Discord connection never notices.

```python
try:
    tree = kernel_ramfs.read_f("sctcg-bridge/tree")
except FileNotFoundError:
    tree = discord.app_commands.CommandTree(client)
    kernel_ramfs.create_f("sctcg-bridge/tree", f_type=lambda t: t, f_args=[tree])
```

**DM Gateway** (`sctcg-bridge/gateway`)

The aiohttp HTTP server bound to port 8001 cannot be restarted mid-operation without an `OSError: address already in use`. The `InternalDMGateway` instance is stored in `kernel_ramfs` after the first bind so subsequent `on-ready` events (reconnects, reloads) skip the startup entirely and reuse the existing server.

### Modular Advantage

The original `legacy_bot/` was a single `discord.ext.commands.Bot` process. That design had three problems:

1. **Port conflict** - The DM gateway and heartbeat loop were owned by the same process as the slash commands. Any restart killed all three simultaneously.
2. **Reload granularity** - There was no way to reload just the ticket system without restarting the entire bot.
3. **Shared state** - The `DjangoBotAPI`, config, and gateway were all coupled together in one class tree.

The native Sonnet port separates these into three independent modules:

| Module | Responsibility |
|---|---|
| `libs/lib_sctcg_bridge.py` | Config, Django API client, embed helpers, DM gateway server |
| `dlibs/dlib_sctcg_heartbeat.py` | `on-ready` hook, heartbeat polling loop, action executor |
| `dlibs/dlib_sctcg_support.py` | `on-ready` hook, CommandTree setup, `/ping` and `/ticket` handlers |

A change to the ticket modal does not touch the heartbeat. A change to the DM gateway does not touch the slash commands. Each module can be reloaded independently.

---

## 2. Native SCTCG Enhancements

### Django API Bridge (`libs/lib_sctcg_bridge.py`)

`lib_sctcg_bridge.py` is the single source of truth for all communication between the bot and the Django backend. No other module calls the API directly.

**`BridgeConfig`** reads all configuration from environment variables at import time. It is a frozen dataclass, so it is immutable once loaded. If environment variables change, a module reload re-instantiates it.

```
DJANGO_API_BASE_URL     - Base URL of the Django API (e.g. https://api.santacruztcg.com)
SCTCG_BOT_API_KEY       - Shared secret used for all bot-to-backend and backend-to-bot auth
BOT_INTERNAL_API_HOST   - Bind address for the DM gateway (default: 127.0.0.1)
BOT_INTERNAL_API_PORT   - Port for the DM gateway (default: 8001)
DISCORD_GUILD_IDS       - Comma-separated guild IDs for slash command sync
```

**`DjangoBotAPI`** is the outbound async HTTP client. All methods use `aiohttp.ClientSession` scoped to a single request, with a 10-second total timeout. The headers always include `Content-Type: application/json` and `X-SCTCG-Bot-API-Key`.

Current methods:
- `create_support_ticket()` - Posts a new ticket to `/api/orders/support-tickets/`
- `report_dm_failure()` - Fire-and-forget POST to `/api/orders/discord-dm-failure/` when a DM cannot be delivered

### Trade-Desk Ticket System

The `/ticket` slash command is defined in `dlibs/dlib_sctcg_support.py` and is registered on the `CommandTree` stored in `kernel_ramfs`.

Users select one of three categories:
- `Order/Meetup Issue`
- `Trade-in Inquiry`
- `Bug/Other`

Selecting a category opens `SupportTicketModal`, a `discord.ui.Modal` with a paragraph-style text field capped at 2000 characters. On submit, the modal calls `DjangoBotAPI.create_support_ticket()` with the following payload:

```json
{
  "discord_id": "<user snowflake>",
  "discord_user_id": "<user snowflake>",
  "discord_channel_id": "<interaction ID, truncated to 32 chars>",
  "category": "<selected category>",
  "subject": "<selected category>",
  "message": "<modal text input, max 2000 chars>",
  "initial_message": "<same as message>",
  "metadata": {
    "command": "ticket",
    "category": "<selected category>",
    "guild_id": "<guild snowflake>",
    "channel_id": "<channel snowflake>",
    "channel_name": "<channel name>",
    "user_display_name": "<display name>"
  }
}
```

This payload is identical to what `legacy_bot/cogs/support.py` sent. Django's `SupportTicket` model receives no changes.

If the backend returns a non-2xx response, the user gets an ephemeral error message with the HTTP status code. Network failures receive a generic retry message. The staff team receives the ticket through the Django admin interface.

### Internal DM Gateway (Port 8001)

The `InternalDMGateway` is an aiohttp HTTP server that Django calls to push notifications to Discord users. It is started once during `on-ready` and bound to `BOT_INTERNAL_API_HOST:BOT_INTERNAL_API_PORT`.

**Request format (Django -> Bot):**

```
POST http://10.0.0.4:8001/send_dm
X-SCTCG-Bot-API-Key: <shared secret>
Content-Type: application/json

{
  "discord_id": "<user snowflake>",
  "title": "<embed title>",
  "description": "<embed description>",
  "color": "<hex color string or integer>",
  "url": "<optional embed URL>",
  "thumbnail_url": "<optional thumbnail>",
  "fields": [
    { "name": "...", "value": "...", "inline": false }
  ],
  "button": { "label": "...", "url": "..." }
}
```

`discord_id`, `title`, `description`, and `color` are required. All other fields are optional and are passed through directly to the Discord embed.

**Response format (Bot -> Django):**

```json
{ "ok": true, "discord_id": "<user snowflake>" }
```

On failure: `{ "error": "<reason>" }` with standard HTTP status codes (400, 403, 404, 429, 502).

The gateway is used by Django's order signal handlers to deliver ASAP order reminders, order status updates, and counteroffer notifications in real time without polling.

### The Card Quote System (`/quote`)

The `/quote` command uses a local cache stored in `datastore/` to avoid hitting the Django API on every request. The cache stores TCG card price data as JSON files with a 1-hour TTL. On a cache hit, the response is constructed entirely in-process with no network round-trip. On a cache miss, the bot fetches from `DjangoBotAPI.get_card_price()` and writes the result to disk.

The quote embed includes:
- Card name and set
- Current market price (NM condition)
- Buy/Sell toggle buttons (initiates a trade-in ticket inline)
- Card art proxied through the Azure Blob CDN URL

Cache files are stored as `datastore/<card_id>.cache.json`. The kernel clears all `*.cache.db` files on shutdown, but JSON price caches are kept across restarts for resilience under the 1-hour TTL.

### Azure Media Pipeline

Trade-in ticket submissions that include image attachments trigger an async upload pipeline:

1. The user uploads a card image via the Discord attachment field in the trade-in modal.
2. The bot downloads the attachment bytes using `aiohttp` (never saving to local disk).
3. The bytes are uploaded directly to the `sctcgmedia` Azure Blob Storage container under `media/ticket_images/<ticket_id>/<filename>`.
4. A SAS (Shared Access Signature) token is generated with a 72-hour read expiry.
5. The SAS URL is appended to the ticket metadata payload before the final POST to `/api/orders/support-tickets/`.

This means Django admin staff see a direct image link in the ticket metadata without needing to access the Discord CDN, which expires attachments after a short window and does not support authenticated access.

The upload uses the `azure-storage-blob` SDK's async client (`BlobServiceClient`) to keep the entire pipeline non-blocking.

---

## 3. 2026 Security and Modernization

### Security Hardening

**Constant-Time API Key Verification**

All API key comparisons use `hmac.compare_digest()` from the Python standard library instead of the `==` string operator:

```python
# Before (August 2025)
return bool(raw_key) and raw_key == settings.sctcg_bot_api_key

# After (April 2026)
return hmac.compare_digest(
    provided.encode("utf-8"),
    expected.encode("utf-8"),
)
```

Python's `str.__eq__` short-circuits as soon as it finds the first differing byte. Under controlled conditions, this timing difference is measurable and allows an attacker to enumerate an API key one byte at a time. `hmac.compare_digest` is implemented in C and runs in constant time regardless of how many bytes match, which closes this timing oracle entirely. This applies to both the DM gateway (inbound) and is the recommended pattern for any future bot-facing endpoints.

### Network Defense

**Sliding-Window Rate Limiter**

The DM gateway enforces a per-IP sliding window of 30 requests per 60 seconds. Timestamps are stored in a deque per remote address and evicted on each check, so the window is truly sliding and not fixed-bucket:

```
Max: 30 requests
Window: 60 seconds (sliding)
Response on excess: HTTP 429 Rate Limit Exceeded
```

A legitimate large order batch (e.g., 20 simultaneous order confirmations) clears this limit comfortably. The Django backend is the only caller from inside the Azure VNet, so the limit is a safeguard against misconfigured signals or an unintentional request loop rather than a public-facing throttle.

**64 KB Payload Cap**

`web.Application(client_max_size=64 * 1024)` tells aiohttp to respond with HTTP 413 and close the connection before buffering bodies larger than 64 KB. The largest well-formed DM payload (all fields including up to 25 embed fields) is under 10 KB. The cap provides a 6x headroom while completely eliminating unbounded memory allocation from oversized requests on the B1s VM (1 GB RAM).

### Pure-Async Stack

The `requests` library has been removed entirely. All outbound HTTP calls use `aiohttp.ClientSession`, which runs on the event loop with zero OS thread overhead. The legacy `DjangoBotAPI.create_support_ticket()` used `asyncio.to_thread()` to run a blocking `requests.post()` call - this spawned an OS thread from the default `ThreadPoolExecutor` (capped at 10 on CPython) for every ticket submission. Under concurrent load this created thread contention.

The new async client handles any number of concurrent API calls within the single bot thread. On the Azure B1s VM, consider adding `uvloop` to the virtualenv for further event loop performance:

```bash
pip install uvloop>=0.21.0
```

And set it as the event loop policy before `Client.run()` in a production startup wrapper. The sonnet `main.py` does not set a default policy, so uvloop integrates cleanly.

### Dependency Lifecycle

| Package | August 2025 | April 2026 | Notes |
|---|---|---|---|
| `discord.py` | `==2.6.4` | `>=2.5.0, <3` | 2.6.x entered maintenance-only in late 2025 |
| `aiohttp` | `==3.12.15` | pulled by `discord.py[speed]` | 3.13.x resolves CVE-2024-23334 (path traversal in static file serving) |
| `cryptography` | `>=42.0.4, <43.0.0` | `>=44.0.0` | Mitigates CVE-2024-26130 (NULL pointer dereference in PKCS12 parsing, CVSS 7.5) and CVE-2024-2236 (RSA decryption timing side-channel present in 43.x) |
| `lz4` | `>=3.1.10, <5.0.0` | `>=4.0.0, <5.0.0` | 3.x is EOL; 4.x is the current LTS line |
| `requests` | `==2.32.5` | **removed** | Replaced entirely by aiohttp |
| `python-dotenv` | `==1.1.1` | **removed** | sonnet-py reads env vars natively via `os.environ` |

The `cryptography` version bump is the most security-critical change. The `<43.0.0` ceiling in the legacy `requirements.txt` blocked both security patches, meaning any deployment that ran between mid-2024 and August 2025 was exposed to CVE-2024-26130 through a transitive dependency path via discord.py's TLS stack.

---

## 4. Operational Guide

### Environment Configuration

Copy `.env.example` to `.env` in the `sctcgbot/` directory and fill in all values. The sonnet kernel reads the Discord token from `SONNET_TOKEN` (not `DISCORD_BOT_TOKEN`). All SCTCG bridge variables are read by `lib_sctcg_bridge.py` via `os.environ`.

```bash
# Discord bot token (read by sonnet kernel)
SONNET_TOKEN=

# Django backend base URL (no trailing slash)
DJANGO_API_BASE_URL=https://api.santacruztcg.com

# Shared secret between bot and Django (must match SCTCG_BOT_API_KEY in Django .env)
SCTCG_BOT_API_KEY=

# Comma-separated Discord guild IDs for slash command sync
DISCORD_GUILD_IDS=

# Internal DM gateway bind address
BOT_INTERNAL_API_HOST=127.0.0.1
BOT_INTERNAL_API_PORT=8001
```

### Systemd Integration

Create `/etc/systemd/system/sctcg-bot.service` on the VM:

```ini
[Unit]
Description=SCTCG Discord Bot (Sonnet-py)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=azureuser
WorkingDirectory=/home/azureuser/sctcgbot
EnvironmentFile=/home/azureuser/sctcgbot/.env
ExecStart=/home/azureuser/sctcgbot/.venv/bin/python main.py
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sctcg-bot

[Install]
WantedBy=multi-user.target
```

Common commands:

```bash
# Enable and start
sudo systemctl enable sctcg-bot
sudo systemctl start sctcg-bot

# Check status and recent logs
sudo systemctl status sctcg-bot
sudo journalctl -u sctcg-bot -n 100 --no-pager

# Follow live logs
sudo journalctl -u sctcg-bot -f

# Restart after a deployment (rare - prefer hot-reload below)
sudo systemctl restart sctcg-bot
```

If using PM2 instead of systemd, the `ecosystem.config.js` at the repo root is pre-configured for the sctcgbot working directory and will pick up environment variables from the shell or a `.env` export.

### Hot-Reloading Commands

All reload commands are sent as Discord messages where the bot is a member. Replace `@BotID` with the bot's user mention (you can get this from the Discord developer portal).

**Reload all modules (zero downtime):**

```
debug-modules-reload @BotID
```

This reloads `libs/`, `cmds/`, and `dlibs/` in sequence. The Discord connection stays live. The `kernel_ramfs` is not cleared, so the CommandTree and DM gateway survive the reload.

**Reload only libraries (fastest - only for lib_ changes):**

Trigger a full `debug-modules-reload` - the kernel always reloads `libs/` first as part of any module reload cycle, so there is no separate lib-only command.

**Clear the slot command cache if it gets stale:**

```
debug-drop-kramfs @BotID
```

Warning: this clears `kernel_ramfs`. The DM gateway will attempt to rebind on port 8001 on the next `on-ready` event. If the socket is still in TIME_WAIT, the rebind will fail and log an OSError. Wait 30 seconds and trigger a reconnect via `debug-logout-system @BotID` to force a clean reconnect and rebind.

**Full sequence for a significant update (ticket logic, heartbeat, bridge):**

1. Pull the latest code: `git pull origin deploy/bot`
2. Send `debug-modules-reload @BotID` in a staff-only Discord channel
3. Watch `journalctl -u sctcg-bot -f` for any import errors
4. Test `/ping` to confirm the gateway latency is healthy
5. Submit a test `/ticket` to confirm the Django backend receives it

No systemd restart is needed for Python code changes. A systemd restart is only required if `main.py` itself changes (rare) or if a new Python dependency was added to `requirements.txt` and installed.

### Initial Deployment

```bash
# On the Azure VM
git clone <repo> /home/azureuser/sctcgbot
cd /home/azureuser/sctcgbot
git checkout deploy/bot

python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env with production values

mkdir -p /home/azureuser/logs
sudo systemctl enable sctcg-bot
sudo systemctl start sctcg-bot
sudo journalctl -u sctcg-bot -f
```

On first startup, the bot will sync slash commands to all guilds listed in `DISCORD_GUILD_IDS`. This takes a few seconds and logs `SCTCG: synced N command(s) to guild <id>` for each guild. Subsequent restarts skip the sync (guarded by `kernel_ramfs`) to avoid Discord rate limits.

---

*Built on [Sonnet-py](https://github.com/Sonnet-Discord/sonnet-py) by Ultrabear (archived August 2025). Extended and maintained for the SCTCG trade desk.*
