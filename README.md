# Order Desk (placeholder name): live selling, from “mine!” to paid and packed

Built for CSSprint 2026 (UST Computer Science Society). The product name is a placeholder while branding is in progress; it lives in one file, `web/src/brand.ts`.

**The problem.** Filipino MSMEs that sell on Facebook Live lose money between the comment and the delivery: claims get missed in a fast comment feed, “joy reservers” claim and never pay, and fake payment screenshots get items shipped for free.

**What this prototype does.**

1. **Captures orders during the live.** Comments from Facebook Live, the in-app live page (viewers scan a QR, watch the seller’s camera and comment), or a replayed recording are read in real time. Rules catch “mine B12”, fuzzy matching catches “mine blu polo”, an LLM reads messy Taglish, and anything unsure goes to a **Needs you** list instead of becoming a wrong order. Claims form a first-come-first-served queue per item with a waitlist.
2. **Checks payments before shipping.** Every buyer gets a private order link to confirm size and quantity and then pay, either by **QR Ph** (mock gateway, verified in seconds through a signed webhook) or by sending money to the seller’s e-wallet and typing the reference. References are checked against the seller’s own statement: **Release**, **Hold** (with every reason) or **Pending**. The seller makes the final call with one tap.
3. **Packs with confidence.** A packing list of verified orders only, grouped by buyer, plus session insights and buyer records (Hold / Watch / Trusted / New).

## Run it (2 minutes)

Needs Python 3.12+ and Node 20+.

```powershell
./start-demo.ps1          # Windows
./start-demo.sh           # macOS / Linux
```

Then open **http://localhost:8000/seller** and enter the seller key `demo-seller-key`. Phones on the same Wi-Fi use the laptop’s LAN address, which the QR codes already point to.

Development mode (hot reload) and deployment are in [docs/08-setup-run-deploy.md](docs/08-setup-run-deploy.md).

## Try the whole flow in 3 minutes

1. **Go live → Live here → Start live.** Click **Turn on camera**. Tap **B12** to put it on camera.
2. Scan the **Scan to join** QR with a phone, enter a name and comment `mine`. The claim shows up on the board within a second, and the phone gets an order link chip.
3. On the phone, open the order: pick a size, **Confirm order**, then **Pay with QR Ph** → **Pay on this phone instead** → **Confirm payment**. The order page flips to *Payment confirmed* and the order is on **Packing**.
4. For the manual path, a second buyer chooses **I paid via GCash**, sends money in DemoWallet, types the reference; another types a made-up reference. On **Payments**, click **Get DemoWallet statement** and upload it: the real one turns **Release**, the fake one **Hold: reference not in your statement**.

The full judge-facing script is in [docs/10-demo-script.md](docs/10-demo-script.md).

## Documentation

| Doc | What it covers |
| --- | --- |
| [01 Overview and architecture](docs/01-overview-and-architecture.md) | System diagram, components, request flow, repo layout |
| [02 Data model](docs/02-data-model.md) | The 13 tables and why they’re shaped that way |
| [03 Comment pipeline and AI](docs/03-comment-pipeline-and-ai.md) | Rules → RapidFuzz → LLM → Needs you, benchmark |
| [04 Orders, queue and states](docs/04-orders-queue-and-states.md) | State machine, guarded transitions, FCFS queue, expiry |
| [05 Payments and the mock QR Ph](docs/05-payments-and-mock-qrph.md) | verify_payment, statements, mock gateway + webhook, DemoWallet |
| [06 Realtime and live video](docs/06-realtime-and-live-video.md) | SSE hub, WebRTC camera streaming, comment sources |
| [07 Frontend and design](docs/07-frontend-and-design.md) | Screens, design tokens, component map |
| [08 Setup, run, deploy](docs/08-setup-run-deploy.md) | Local, dev mode, Supabase, Render/Vercel, Meta, OpenRouter |
| [09 Testing and QA](docs/09-testing-and-qa.md) | 49 backend tests, 11 Playwright E2E flows, benchmark |
| [10 Demo script](docs/10-demo-script.md) | Step-by-step pitch demo with fallbacks |
| [11 Defend the code (Q&A)](docs/11-defend-the-code-qa.md) | Likely judge questions with answers that point at code |
| [12 Security, privacy, limits](docs/12-security-privacy-limits.md) | RA 10173, threat table, known limitations |

## Tech stack

FastAPI · SQLAlchemy 2 (SQLite locally, PostgreSQL/Supabase in production) · RapidFuzz · httpx · Pydantic · OpenRouter (LLM) · Meta Live Video API · Server-Sent Events · WebRTC · React 19 + Vite + TypeScript · Tailwind CSS 4 · React Router · qrcode · pytest · Playwright.

## Libraries and APIs used (citations)

| Name | Used for | Link |
| --- | --- | --- |
| Meta Live Video API | Reading live comments (read-only) | https://developers.facebook.com/docs/live-video-api |
| FastAPI / Uvicorn | Backend framework and server | https://fastapi.tiangolo.com · https://www.uvicorn.org |
| SQLAlchemy, aiosqlite, asyncpg | Database access (SQLite / Postgres) | https://www.sqlalchemy.org |
| Supabase | Hosted Postgres (production option) | https://supabase.com/docs |
| RapidFuzz | Fuzzy catalog and reference matching | https://github.com/rapidfuzz/RapidFuzz |
| httpx | Meta stream and OpenRouter calls | https://www.python-httpx.org |
| Pydantic / pydantic-settings | Validating LLM output, request bodies, settings | https://docs.pydantic.dev |
| OpenRouter | LLM API for messy comments | https://openrouter.ai/docs |
| PayMongo QR Ph (design reference) | The mock gateway follows its QR Ph + webhook flow | https://docs.paymongo.com/docs/payment-acceptance-qr-ph |
| React, React Router, Vite, TypeScript | Frontend | https://react.dev · https://reactrouter.com · https://vite.dev |
| Tailwind CSS | Styling | https://tailwindcss.com |
| node-qrcode | QR code rendering | https://github.com/soldair/node-qrcode |
| Google Fonts (Bricolage Grotesque, Inter, JetBrains Mono) | Typography | https://fonts.google.com |
| pytest, Playwright | Unit/API tests and browser end-to-end tests | https://pytest.org · https://playwright.dev |

AI assistance: Claude was used for research, planning and coding help, as the event rules allow. Every part of the code is documented in `docs/` so the team can explain it.
