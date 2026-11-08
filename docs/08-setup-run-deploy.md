# 08 · Setup, run, deploy

## Requirements

Python 3.12+, Node 20+ (tested with Python 3.12.3, Node 24). No database server, API key or account is needed for the local demo.

## Fastest: one command

```powershell
./start-demo.ps1        # Windows PowerShell
./start-demo.sh         # macOS / Linux
```

It creates `api/.venv`, installs Python packages, installs and builds the web app, and serves everything at **http://localhost:8000** (`--host 0.0.0.0`, so phones on the same Wi-Fi can open the LAN address the QR codes show). Seller key: `demo-seller-key`.

The first start creates `api/data/live_seller.db` and seeds Jessa’s ukay shop (items B1–B20). Delete that file, or use **Settings → Reset demo data**, to start over.

## Development mode (hot reload)

```bash
# terminal 1: API
cd api
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt       # macOS/Linux: .venv/bin/pip
.venv/Scripts/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# terminal 2: web
cd web
npm install
npm run dev            # http://localhost:5173, /api is proxied to :8000
```

Interactive API docs: http://localhost:8000/api/docs

## Configuration (`api/.env`, see `api/.env.example`)

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | SQLite file in `api/data/` | `postgresql+asyncpg://…` for Supabase/Postgres |
| `SELLER_KEY` | `demo-seller-key` | Key the seller screens send. Change before deploying |
| `OPENROUTER_API_KEY` | empty | Turns on the LLM step. Without it, unclear comments go to Needs you |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-5.5` | Any OpenRouter model id that returns JSON; pick with the benchmark |
| `META_PAGE_TOKEN` | empty | Facebook Page access token for the Facebook Live source |
| `PUBLIC_WEB_URL` | empty | Base URL for QR codes (a tunnel or deployed URL). Empty = LAN address |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS origins when the web app is hosted separately |
| `GATEWAY_WEBHOOK_SECRET` | `mockpay-dev-secret` | HMAC secret of the mock QR Ph gateway webhook |
| `HOLD_MINUTES`, `PAY_WINDOW_HOURS` | 15, 24 | Defaults; the seller can change them in Settings |
| `EXPIRY_INTERVAL_S` | 10 | How often the expiry loop runs |

Web build variables (optional): `VITE_API_URL` (API on another domain), `VITE_SELLER_KEY` (pre-fill the key), `VITE_PUBLIC_URL`.

## Phones that aren’t on the same Wi-Fi

Use a tunnel and tell the app its public URL so QR codes use it:

```bash
cloudflared tunnel --url http://localhost:8000     # or: ngrok http 8000
# then set PUBLIC_WEB_URL=https://<the-tunnel-url> in api/.env and restart
```

HTTPS through a tunnel also lets the seller open the board from a phone or another laptop and still use the camera.

## Supabase (Postgres)

1. Create a project (Singapore region if offered).
2. Optional: run `supabase/schema.sql` in the SQL editor (it also turns on Row Level Security). The app creates missing tables itself on startup.
3. Set `DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<password>@<pooler-host>:6543/postgres`. The asyncpg statement cache is turned off automatically, which the transaction pooler requires.

Verified: the full backend test suite passes on PostgreSQL 18 (`TEST_DATABASE_URL=postgresql+asyncpg://… pytest`).

Regenerate `supabase/schema.sql` after changing `api/app/schema.py`: `cd api && .venv/Scripts/python -m scripts.export_schema`.

## Deploy (Render, one service)

`render.yaml` builds the web app and runs the API, which serves it. Set `DATABASE_URL` (Supabase), `SELLER_KEY`, and optionally `OPENROUTER_API_KEY`, `META_PAGE_TOKEN`, `PUBLIC_WEB_URL`. Run **one instance only**: the SSE hub and WebRTC signaling live in memory. Render’s free tier sleeps after 15 minutes: open `/api/health` a minute before demoing.

Split hosting (web on Vercel, API on Render) also works: `web/vercel.json` rewrites routes to `index.html`; set `VITE_API_URL` on Vercel and `WEB_ORIGIN` on Render.

## Facebook Live (Meta)

1. Create a Meta app (development mode), add team members as testers, connect the seller’s Page.
2. Get a long-lived user token, then the Page token from `/me/accounts`; put it in `META_PAGE_TOKEN`.
3. Start the live on the Page, then call `GET /api/meta/live-videos?page_id=<id>` (seller key) or copy the live video id from the URL, and pick **Facebook Live** on the Go live screen.
4. Comments from people without a role on the app may need App Review; the in-app live page is the fallback that always works.
5. A new Page can only go live after 60 days and 100 followers. For a test you can go live from a personal profile instead: make a Consumer-type app with the Facebook Login use case, add `user_videos`, put a **user** token in `META_PAGE_TOKEN`, and paste the video id from the live's URL. Meta refuses the live stream for profile videos, so the reader polls the comments every 2 s.

## OpenRouter (LLM)

Set `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`), restart, and check **Settings → Connections**. Pick providers that don’t keep or train on prompts in your OpenRouter privacy settings. Run the benchmark to compare models: `cd api && .venv/Scripts/python -m bench.run_bench`.
