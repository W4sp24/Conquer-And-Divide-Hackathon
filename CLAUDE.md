# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Hackathon prototype (CSSprint 2026) for Filipino Facebook Live sellers: live comments → orders → verified payments → packing list. FastAPI backend in `api/`, React SPA in `web/`, team-facing explanations in `docs/01..12` (read the relevant doc before changing a subsystem; `docs/11-defend-the-code-qa.md` must stay true to the code). The product is **mineIt!** (capital I; the logo and brand colours are described in `docs/07-frontend-and-design.md`). The name lives in `web/src/brand.ts`, the logo files in `web/public/` are generated from `docs/assets/logo.png` by `web/scripts/make-brand-assets.py`, and brand colours are tokens in `web/src/index.css`. `Documentations and references/` holds planning notes and is not code. `suki-ai/` is the team's separate GitHub clone and is gitignored by this repo.

## Commands

Backend (run from `api/`, Windows venv paths shown; use `.venv/bin/` on macOS/Linux):

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest                                   # all 49 tests
.venv/Scripts/python -m pytest tests/test_flow.py::test_name -q  # single test
TEST_DATABASE_URL=postgresql+asyncpg://... .venv/Scripts/python -m pytest  # same suite on Postgres
.venv/Scripts/python bench/run_bench.py      # parsing accuracy on bench/comments.csv (LLM tier needs OPENROUTER_API_KEY)
.venv/Scripts/python scripts/export_schema.py  # regenerate supabase/schema.sql from app/schema.py
```

Frontend (run from `web/`):

```bash
npm run dev        # Vite on :5173, proxies /api to :8000
npm run build      # tsc -b + vite build → web/dist (served by FastAPI)
npm run lint       # oxlint
npm run test:e2e   # Playwright (12 flows); build first. Starts its own backend on :8010 with a fresh api/data/e2e-*.db
npx playwright test -g "test title"   # single E2E test
npm run tour       # screenshot tour → test-results/tour
```

One-command demo: `./start-demo.ps1` (or `start-demo.sh`) builds the web app and serves everything on http://localhost:8000. Seller screens need the key `demo-seller-key` (sent as `X-Seller-Key`). All `api/.env` settings are optional; see `api/.env.example`.

## Architecture

**One process.** `app/main.py` mounts the API as a sub-app at `/api` and serves `web/dist` as an SPA from the same app. The lifespan creates tables, seeds the demo shop (`seed.py`, items B1–B20) and starts the expiry loop. Background tasks (comment sources, expiry) run in-process, so the backend is single-instance by design.

**Database.** SQLAlchemy 2 Core (no ORM), async. Tables live in `schema.py`; query helpers (`tx`, `fetch`, `fetchone`, `execute`) and shared named queries live in `db.py`. SQLite (default, `api/data/live_seller.db`) serializes transactions with one asyncio lock. Postgres uses asyncpg with the statement cache off for the Supabase pooler. Money is always integer centavos.

**Comment pipeline** (`app/pipeline/cascade.py`). Every comment goes through `classify`: regex rules (`rules.py`), then RapidFuzz against the catalog (`fuzzy.py`, accepted only at ≥88 with a 5-point lead), then the LLM via OpenRouter (`llm.py`, Pydantic-validated, item codes restricted to the catalog, confidence ≥0.75). Anything uncertain becomes a "Needs you" review item, never a guessed order. Seller fixes are stored in `corrections` and reused as few-shot examples. Comment sources in `app/sources/` (Meta Live Video stream, `.jsonl` replay from `api/recordings/`, in-app viewer chat, seller test comments) all funnel into `runner.ingest`.

**Orders** (`app/orders/`). Status changes must go through `states.transition()`, which does `UPDATE … WHERE status = :current` against the `ALLOWED` map and writes an `order_events` audit row. Never update `orders.status` directly. `queue.rebalance()` assigns stock units strictly first-come-first-served by the comment's own timestamp, with everyone else waitlisted. Call it after anything that frees or consumes stock. `expire_due` releases unconfirmed claims (hold minutes) and unpaid orders (pay window).

**Payments** (`app/payments/`). `verify.verify_payment` is a pure function returning RELEASE / HOLD / PENDING with every reason. PENDING means the latest statement doesn't cover the payment time yet. `statement.py` parses e-wallet/bank CSVs with flexible column names. `gateway.py` is a mock QR Ph gateway ("MockPay") modelled on PayMongo: payment intent → `/pay/:id` page → HMAC-SHA256-signed `payment.paid` webhook (`X-MockPay-Signature: t=…,te=…`, 5-minute window). Gateway-paid orders release automatically. `wallet.py` is the DemoWallet mock e-wallet that exports a GCash-style statement CSV.

**Realtime.** `hub.py` is an in-memory SSE fan-out keyed `session:<id>`, `seller:<id>`, `viewer:<id>` and `order:<id>`. The frontend subscribes with `useEventStream` and reloads read models from `views.py`. Live video is seller→viewer WebRTC (`web/src/lib/rtc.ts`, `app/rtc.py`) with non-trickle ICE, with SDP relayed over REST + SSE. No TURN server is used.

**Routers** (`app/routers/`). Seller routes depend on `auth.seller_only`. Public routes (`buyer.py`, `public.py`) are reached by unguessable order/session ids, and viewer comments are rate limited. Buyer names are masked (`db.mask_name`, surname-particle aware) on anything shown publicly.

**Frontend** (`web/src/`). React 19 + React Router 7 + Tailwind 4. Design tokens live in `index.css` under `@theme`, taken from the original mockup palette. `seller/` holds the desk screens behind `SellerLayout` (key gate). `public/` holds the phone pages: buyer order, MockPay page, DemoWallet and live viewer. QR codes use `lib/publicUrl.ts` (LAN IP or `PUBLIC_WEB_URL`), but on-device links must stay relative.

## Testing notes

- `tests/conftest.py` forces a temp SQLite DB, `SELLER_KEY=test-key`, no OpenRouter key and a 0.2 s expiry loop. Tests must not depend on network services.
- E2E tests use Chromium's fake camera flags, so the WebRTC flow is tested for real.
- Statuses are always shown as a word plus a colour (projector readability). Keep that when touching UI.
