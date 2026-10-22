# 09 · Testing and QA

Three layers, all runnable on a laptop with no accounts.

## 1. Backend tests (pytest): 49 tests

```bash
cd api
.venv/Scripts/python -m pytest -q                       # SQLite (default)
TEST_DATABASE_URL=postgresql+asyncpg://user@host:port/db .venv/Scripts/python -m pytest -q   # Postgres
```

| File | What it proves |
| --- | --- |
| `tests/test_rules.py` (16) | The regex step: codes in every spelling, bare claims, lone “m”, cancels in Tagalog, waitlist, chat ignored, sizes/quantities, item-aware size (numeric sizes, “M” needs a hint) |
| `tests/test_verify.py` (11) | `verify_payment` as a table of cases: clean match, missing/reused/unknown reference, stale statement → Pending, amount mismatch, old transfer reused, 3× spike, new buyer, all reasons at once |
| `tests/test_statement.py` (5) | GCash-style export with title rows and debits, bank-style dates and commas, missing columns |
| `tests/test_flow.py` (17) | The whole API end to end: auth, claim → waitlist → cancel promotes, duplicate claims, on-camera bare claim, fuzzy description, review + fix, manual payment with DemoWallet, fake reference held after statement upload, release all green, reject → buyer label HOLD, reused reference, Instant QR via mock gateway (auto-released), bad webhook signature rejected, packing, hold expiry promotes the waitlist, insights + export, viewer chat + privacy of names, delete-my-data, reset demo |

Last run: **49 passed on SQLite and 49 passed on PostgreSQL 18.**

## 2. Browser end-to-end tests (Playwright): 11 flows

```bash
cd web
npm run build
npm run test:e2e          # starts its own backend on :8010 with a fresh database
```

Chromium runs with a fake camera (`--use-fake-device-for-media-stream`), so the WebRTC video path is tested for real.

| # | Flow |
| --- | --- |
| 1 | Seller unlock: wrong key rejected, right key opens the desk |
| 2 | Go live here, put B12 on camera, typed comment “mine B12” → claimed on the stage; “mine po” → waitlisted; Taglish description → claimed B7; chat ignored |
| 3 | Unclear comment lands in Needs you; seller picks item and size, Approve → claimed |
| 4 | “cancel B12 po” → next buyer promoted to Claimed |
| 5 | **Instant QR:** buyer must pick a size, confirms, QR Ph code appears; a second phone opens the QR link, confirms payment; the buyer page flips to *Payment confirmed* by itself |
| 6 | **Manual:** buyer pays in DemoWallet, types the reference (button stays disabled until the self-check is ticked); another buyer types a fake reference; both Pending; statement upload → 1 Release, 1 Hold “Reference not in your statement”; Release all green → buyer page flips; Reject the fake → buyer sees a neutral note, never the reason; buyer record shows Hold |
| 7 | Packing shows only verified orders; Packed and Shipped toggles |
| 8 | **Viewer:** seller turns on the camera; a phone opens the viewer QR link and receives the live video (non-zero video width); joins with a name, comments “mine” → “claimed B9”, order chip appears, seller’s stage shows the claim, chip opens the order |
| 9 | Catalog: validation, add with sizes/keywords, edit price, delete with confirmation |
| 10 | Insights and every seller screen render with no page errors |
| 11 | Ending the live refuses new comments (409) but buyer links keep working |

Last run: **11 passed.** Bugs these tests found and fixed during the build: on-device links pointed at the LAN address instead of the current origin; grouped buttons were wrapped in one `<label>` (wrong accessible names); the buyer could have seen the seller’s reject reason.

## 3. Taglish benchmark

`cd api && .venv/Scripts/python -m bench.run_bench` (see doc 03). Starter set: rules 58% right / 0% wrong orders; rules + RapidFuzz 94.2% right / 0% wrong orders. Add the LLM rows with an OpenRouter key.

## Visual review

`npm run tour` (with the app running on :8000) walks every screen, replays a recorded live at 4×, puts orders through every payment state, and saves screenshots to `web/test-results/tour/`. Use it before the pitch to check nothing looks off on the projector resolution (1440×900) and on a phone (390×844).

## Manual QA checklist for demo day

- [ ] `/api/health` returns `{"ok": true}`
- [ ] Seller board opened on `http://localhost:8000` (camera needs localhost or HTTPS)
- [ ] A phone on the venue Wi-Fi (or hotspot) can open the **Scan to join** QR
- [ ] Camera picks the right device; mic muted if the room is noisy
- [ ] Replay tested at 2× as the fallback
- [ ] **Settings → Reset demo data** right before going on stage
