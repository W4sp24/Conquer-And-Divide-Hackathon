# 11 · Defend the code: likely questions and answers

Each answer points at the code so anyone on the team can open it and show it.

## Product and AI

**Why use AI at all? Couldn’t keywords do it?**
Keywords handle clean comments, and we use them first (`pipeline/rules.py`). Real Taglish comments like “pa mine po yung blue na polo, M sana” or “sakin na lang yung maong jacket” don’t follow a pattern. The benchmark (doc 03) shows rules alone send 42% of comments to manual review; RapidFuzz brings that to 5.8%; the LLM is for the rest. Rules and RapidFuzz are instant and free, so the LLM is only paid for when it’s needed.

**What if the AI is wrong?**
It can’t create a wrong order silently. Its answer must parse into a strict schema (`pipeline/llm.py → Parse`), it may only name items it was offered (invented codes are rejected), and anything below 0.75 confidence goes to Needs you. Even a confident claim is only a *claim*: the buyer confirms item, size and quantity on their private page before the order counts.

**What if the AI is down or there’s no API key?**
`llm_parse` returns `None` and the comment goes to Needs you. Rules and fuzzy matching keep working. The demo runs fully without a key.

**Does the AI see personal data?**
No. It gets the comment text, item codes/names and the buyer’s recent item codes, never names or platform ids (`cascade.llm_context`). That’s deliberate for RA 10173.

**How does it “learn”?**
Every fix in Needs you is stored in `corrections` and sent as few-shot examples next time (all of them up to 30, else the 10 most similar). No retraining, no vector DB.

## Orders and fairness

**Two people comment “mine” at the same time. Who gets it?**
Whoever’s comment has the earlier platform timestamp. `queue.rebalance` sorts by `claimed_at`, which is copied from the comment’s `created_time`, not from when we processed it. So a slow parse never loses someone their place.

**What stops double-processing or race conditions?**
Comment ids are primary keys (a resent comment is ignored). Every status change is a guarded update (`orders/states.py → transition`): it only succeeds if the order is still in the state we read, otherwise it returns `None`. On SQLite all transactions are serialized by one lock; on Postgres the guarded `UPDATE … WHERE status = …` is atomic.

**What happens to joy reservers?**
A claim must be confirmed within 15 minutes and paid within 24 hours (seller settings). The expiry loop (`queue.expire_due`) expires late orders, promotes the next buyer, and counts unpaid expiries on the buyer’s record, which drives the WATCH/HOLD labels.

**Can a buyer increase quantity to steal stock?**
No. `queue.confirm` caps quantity at what’s free, and stock is counted in units.

## Payments

**How do you catch a fake GCash screenshot?**
We don’t look at screenshots at all. The buyer types the reference; we check it against the seller’s own statement (`payments/verify.py`). A fake screenshot has a reference that isn’t in her statement → Hold. An edited amount → amount mismatch. Someone else’s real reference → reused reference (unique database rule on `proofs`). An old genuine receipt → “payment is older than the order”.

**What if the buyer paid but the seller hasn’t uploaded a statement yet?**
That’s *Pending*, not *Hold*. `statement_uploads.covers_until` tells us whether the statement could even contain the payment. Honest buyers are never flagged for the seller being behind.

**Is the QR Ph payment real?**
It’s a mock, by design, and labelled “Test mode” on screen. It reproduces the real gateway contract: a payment intent for the exact amount, a QR that encodes the checkout, and a **signed** `payment.paid` webhook (HMAC-SHA256 over timestamp + body, 5-minute replay window) delivered to `POST /api/webhooks/qrph` (`payments/gateway.py`). Swapping in PayMongo means changing `create_intent()` and the payload paths, nothing else.

**Why can QR Ph payments skip the seller’s Release tap?**
Because the money’s arrival is confirmed by the gateway itself, not by something the buyer typed. It still runs through the same `verify_payment` (amount must match), and the seller can turn auto-release off in Settings.

**Can someone fake the webhook?**
Not without the secret: the signature is checked with a constant-time compare, and events older than 5 minutes are refused. Duplicate deliveries add nothing (unique rule on `payments`).

**Why centavos?**
Floats can’t represent ₱0.10 exactly. Integers can. The statement parser uses `Decimal` before converting.

## Architecture

**Why one backend process?**
The SSE hub and WebRTC signaling are in memory, which is simplest and fast for one seller. To scale out, move the hub to Redis or Supabase Realtime; nothing else changes because all events go through `hub.publish`.

**Why SSE instead of WebSockets?**
Updates only flow server → screen; actions are normal REST calls. SSE reconnects by itself and the client reloads the snapshot on reconnect, so nothing is missed.

**Where does the video go? Do you store it?**
Nowhere. WebRTC sends it peer-to-peer from the seller’s browser to each viewer. The backend only passes the connection offer/answer (`api/app/rtc.py`).

**SQLite in production?**
SQLite is for the laptop demo. Set `DATABASE_URL` to Supabase Postgres and the same code runs; the whole test suite passes on PostgreSQL (doc 09).

**How is the seller authenticated?**
A shared seller key (`X-Seller-Key`) — enough for a single-seller demo, and stated as out of scope. Buyers need no login: their link carries a 128-bit random token (`secrets.token_urlsafe(16)`), and the page shows only their own order.

## Data and law

**Data Privacy Act (RA 10173)?**
We store only what an order needs (platform id, display name, comment, order and payment details; no addresses, phone numbers or account numbers). Names are masked on projected and public screens. The LLM never sees names. Buyer history stays in one seller’s shop. The seller can delete a buyer’s data (`DELETE /api/buyers/{id}`), which also frees their held items for the next buyer.

**Internet Transactions Act (RA 11967)?**
Prices are shown in the catalog and on every order page, and each order keeps a clear record of what was agreed and when (`order_events`).

**Meta rules?**
Read-only access to the seller’s own Page through the official Live Video API, with the token kept on the backend. No scraping, no auto-replies.
