# 07 · Frontend and design

React 19 + Vite + TypeScript + Tailwind CSS 4, React Router. All screens are lazy-loaded routes (`web/src/App.tsx`).

## Screens

| Route | Screen | File | What’s on it |
| --- | --- | --- | --- |
| `/seller/sessions` | Go live / Lives | `seller/Sessions.tsx` | Pick the source (Live here, Facebook Live, Replay), name the live, past lives with Export |
| `/seller/live/:sid` | **Live board** (the demo’s main screen) | `seller/LiveBoard.tsx` | Dark “stage”: camera + item on camera + its queue + viewer QR; item grid (tap = put on camera); Needs you; comment feed with how each comment was read; test comment box |
| `/seller/payments` | Payments | `seller/Payments.tsx` | Statement drop zone, To check list with Release/Hold/Pending + every reason, Release all green, Reject, Ask buyer, Waiting for payment |
| `/seller/packing` | Packing | `seller/Packing.tsx` | Verified orders grouped by buyer, Packed/Shipped toggles, totals, print |
| `/seller/insights` | Insights | `seller/Insights.tsx` | KPIs, order value per 10 minutes, how comments were read, funnel, payment checks, “stopped before shipping”, items table |
| `/seller/catalog` | Catalog | `seller/Catalog.tsx` | Item table, add/edit/duplicate/delete, photo upload (resized to 480 px in the browser), sizes, keywords |
| `/seller/buyers` | Buyers | `seller/Buyers.tsx` | Labels with counters, filter, delete a buyer’s data |
| `/seller/settings` | Settings | `seller/Settings.tsx` | Payment mode, e-wallet details, auto-release, deadlines, connections, reset demo |
| `/o/:token` | Buyer order page (phone) | `public/BuyerOrder.tsx` | Changes with the order state: Claimed (size, qty, confirm, countdown), Waitlisted (#N in line), Confirmed (QR Ph or manual reference), Checking, Paid/Packed/Shipped, Expired/Cancelled |
| `/live/:sid` | Viewer page (phone) | `public/Viewer.tsx` | Live video, item on camera, comments, comment box, your order links |
| `/pay/:intentId` | Mock QR Ph checkout | `public/PayQR.tsx` | “Bank app” confirmation screen |
| `/w/:sellerId` | DemoWallet | `public/Wallet.tsx` | Send money, receipt with reference |

The order drawer (`seller/OrderDrawer.tsx`) opens from any order chip: buyer link + QR (to open the buyer page on a phone), status, verdict, and the full timeline from `order_events`.

## How screens get data

- `lib/api.ts`: `seller.get/post/...` adds `X-Seller-Key`; `pub.*` for public pages. Errors become readable messages (FastAPI’s `detail`).
- `lib/hooks.ts`: `useEventStream` (SSE + reload on reconnect), `useLoad`, `useDebounced`, `useNow`, `useServerOffset` (countdowns use server time, so a phone with a wrong clock still counts down correctly), `useDeviceId` (anonymous viewer id).
- `seller/SellerLayout.tsx`: unlock screen for the seller key, sidebar with live counts (reviews waiting, payments to check, items to pack) kept fresh by the seller SSE stream.

## Design system

Taken from the team’s mockup and kept consistent (`web/src/index.css`, `@theme`):

| Token | Hex | Used for |
| --- | --- | --- |
| `bg` / `surface` / `sunken` | #F6F7F4 / #FFFFFF / #EEF0EA | Calm, cool off-white working surface |
| `ink` / `ink-2` / `muted` | #1F2926 / #47524E / #5E6965 | Text hierarchy |
| `brand` / `brand-deep` / `brand-soft` | #17806A / #0F5E4D / #E8F3EF | Money that checks out, primary actions |
| `hold` | #B42318 | Hold, live indicator, destructive actions |
| `pending` | #B45309 | Pending, needs review |
| `ai` | #6D28D9 | Anything the AI read |
| `stage` | #1B2421 | The dark camera stage on the live board and the viewer page |

Type: **Bricolage Grotesque** for headings and big numbers, **Inter** for UI text, **JetBrains Mono** for item codes and payment references (they are data people read character by character).

Principles applied:

- **Every status is a word, not only a color** (“Hold”, “Release”, “Waitlist”), so it reads on a projector and for color-blind judges. Verdicts carry an icon too.
- **Amounts always show as pesos with two decimals** from centavos, through one helper.
- **Buyer names are masked** on projected/public screens (“Ana R.”, “Mark D.” for Dela Cruz).
- **One memorable element:** the dark stage with the live camera and the on-camera queue. Everything around it stays quiet.
- Phone pages are thumb-first: big tap targets, one primary action per state, countdowns in tabular figures.
- Accessible: real buttons and labels, `role="radiogroup"` for size/source pickers, `role="group"` for grouped controls, visible focus rings, `aria-live` on feeds, reduced motion respected.

## Branding

The product is **mineIt!** (capital I). The logo is an “M” with a play button and a LIVE pill over the wordmark.

| Where | What |
| --- | --- |
| `docs/assets/logo.png` | The original logo as supplied (opaque, 480×480) |
| `web/scripts/make-brand-assets.py` | Lifts the white backdrop off and writes the files below, plus the README banner |
| `web/public/logo.png`, `logo-mark.png` | Full logo and the M mark, transparent; used on the key screen, the seller header and the buyer page footer |
| `web/public/favicon-32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `manifest.webmanifest` | Tab icon, home-screen icons and install metadata (the icons use the M alone, which stays legible at 32 px) |
| `web/src/brand.ts` | Name, tagline, event name and logo paths |
| `web/src/index.css` | `--color-brand` `#015A5C` (the M), `--color-brand-deep` `#002F38` (the wordmark), `--color-brand-light` `#6ABC9B` (“It!” and the right side of the M), `--color-brand-line` `#AEE5D3` (the play button) |
| `Logo` in `web/src/seller/SellerLayout.tsx` | Header lockup: the mark image plus the name set in Bricolage Grotesque in the logo’s two tones |

The old teal `#17806A` and the placeholder name “Order Desk” are gone. Hold (red), Pending (amber) and AI (violet) keep their own colours so status never depends on the brand teal. MockPay and DemoWallet keep their own look on purpose: they stand in for other companies’ apps.

Regenerate the files after changing the logo: `python web/scripts/make-brand-assets.py` (needs Pillow and numpy).
