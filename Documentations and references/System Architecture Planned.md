# System Architecture: Live Seller Order and Payment System

Oct 22, 2026 · @Ethan

One FastAPI backend on Render runs the whole pipeline: it reads live comments from Meta, turns them into orders, checks payments and pushes every change to the React app on Vercel over SSE. Supabase Postgres stores everything. The LLM is used in one place only, for comments that rules and RapidFuzz can't read.

## At a glance

&#91;embedded content: system architecture · 11 parts, 1 backend\]

Only the backend talks to Meta, OpenRouter, PayMongo and the database. The browser sends requests to the REST routes (statement uploads, Confirm, Release) and gets every change back as SSE events. The Orders module in the middle is the only place an order's state changes.

## Repo layout and environment

One GitHub repo with two apps: `api/` deploys to Render and `web/` deploys to Vercel. Every folder below maps to one section of this doc, so any teammate can find the code they have to defend.

```text
live-seller/
  api/                        FastAPI backend (Render)
    app/
      main.py                 app, CORS, routers, startup tasks
      config.py               env settings (pydantic-settings)
      db.py                   psycopg async pool + small query helpers
      hub.py                  SSE broadcast hub (in memory)
      sources/
        meta_live.py          reads Meta's live_comments stream
        replay.py             replays a recorded session
        runner.py             one background task per live session
      pipeline/
        rules.py              regex: intent, item code, size, qty
        fuzzy.py              RapidFuzz match against the catalog
        llm.py                OpenRouter call + JSON validation
        cascade.py            rules -> fuzzy -> llm -> decision
      orders/
        states.py             allowed transitions + guarded update
        queue.py              claim, waitlist, promote, expiry loop
      payments/
        statement.py          statement CSV -> payment rows
        verify.py             verify_payment (pure function)
        service.py            submit proof, run checks, release, reject
        paymongo.py           optional Instant QR + webhook check
      routers/                sessions, orders, buyer, payments,
                              catalog, stream, webhooks
    recordings/               saved comment streams for Replay
    tests/                    test_rules.py, test_verify.py
    bench/                    comments.csv, run_bench.py
    requirements.txt
  web/                        React + Vite + TypeScript (Vercel)
    src/
      api.ts                  fetch wrapper with the seller key
      useEventStream.ts       SSE hook
      pages/                  LiveBoard, Payments, Packing, Catalog,
                              BuyerOrder
      components/             OrderCard, ItemQueue, ReviewBucket,
                              Scoreboard, StatusBadge
  supabase/schema.sql
  README.md                   setup steps + citations
```

**Backend packages** (`requirements.txt`): fastapi, uvicorn, httpx, rapidfuzz, psycopg\[binary,pool\], pydantic-settings, python-multipart (file upload), pytest.

**Frontend packages:** react, react-router-dom, vite, typescript, tailwindcss. Add shadcn/ui only if you want ready-made cards and dialogs.

| Variable | Where | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Render | Supabase Postgres connection string (use the pooler URL) |
| `META_PAGE_TOKEN` | Render | Page access token for the seller's Facebook Page |
| `OPENROUTER_API_KEY` | Render | LLM calls |
| `OPENROUTER_MODEL` | Render | Model id, picked after the benchmark |
| `SELLER_KEY` | Render + Vercel | Shared demo key the seller screens send in a header |
| `WEB_ORIGIN` | Render | Vercel URL, for CORS |
| `PUBLIC_WEB_URL` | Render | Base URL used to build buyer links |
| `PAYMONGO_SECRET_KEY` | Render | Optional, `sk_test_` key only |
| `PAYMONGO_WEBHOOK_SECRET` | Render | Optional, for checking webhook signatures |
| `VITE_API_URL` | Vercel | Render backend URL |

Secrets live only in Render and Vercel settings and a local `.env` that is in `.gitignore`. Nothing secret goes in the repo.

## Data model

Eleven tables in Supabase Postgres. Money is stored in centavos as whole numbers, and two database rules do the work that matters most: one item code per seller, and one payment reference per seller. Run this once in the Supabase SQL editor as `supabase/schema.sql`.

```sql
-- One demo seller. Real login is out of scope.
create table sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  payment_mode text not null default 'manual'
    check (payment_mode in ('manual', 'instant_qr')),
  payment_details text,           -- shown on the buyer page, e.g. GCash name + last digits
  created_at timestamptz not null default now()
);

create table catalog_items (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  code text not null,             -- 'B12'
  name text not null,
  price_centavos integer not null check (price_centavos > 0),
  sizes text[] not null default '{}',
  stock integer not null default 1 check (stock >= 0),
  keywords text[] not null default '{}',
  photo_url text,
  unique (seller_id, code)
);

create table live_sessions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  source text not null check (source in ('live', 'replay')),
  live_video_id text,             -- Meta id, or the recording name for replay
  current_item_id uuid references catalog_items(id),  -- item on camera
  status text not null default 'idle'
    check (status in ('idle', 'running', 'ended')),
  started_at timestamptz,
  ended_at timestamptz
);

create table buyers (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  meta_user_id text not null,     -- from.id in the Meta comment
  display_name text not null,
  claims int not null default 0,
  verified int not null default 0,
  failed_proofs int not null default 0,
  expired_unpaid int not null default 0,
  cancels int not null default 0,
  max_paid_centavos int not null default 0,
  unique (seller_id, meta_user_id)
);

create table comments (
  id text primary key,            -- Meta comment id, or a replay id
  session_id uuid not null references live_sessions(id),
  buyer_id uuid references buyers(id),
  message text not null,
  created_time timestamptz not null,  -- Meta's time decides queue order
  parse_stage text,               -- rules | fuzzy | llm | review | ignored
  parse_result jsonb,
  confidence real,
  received_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  session_id uuid not null references live_sessions(id),
  buyer_id uuid not null references buyers(id),
  item_id uuid not null references catalog_items(id),
  comment_id text references comments(id),
  size text,
  qty int not null default 1 check (qty > 0),
  total_centavos int not null,
  status text not null default 'CLAIMED' check (status in (
    'CLAIMED', 'WAITLISTED', 'CONFIRMED', 'PROOF_SENT',
    'VERIFIED', 'PACKED', 'SHIPPED', 'EXPIRED', 'CANCELLED')),
  buyer_token text not null unique,   -- the private buyer link
  claimed_at timestamptz not null,    -- copied from the comment time
  hold_until timestamptz,             -- buyer must confirm before this
  pay_by timestamptz,                 -- buyer must pay before this
  verdict text check (verdict in ('RELEASE', 'HOLD', 'PENDING')),
  verdict_reasons text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index orders_queue on orders (item_id, status, claimed_at);

create table order_events (       -- audit trail and demo timeline
  id bigserial primary key,
  order_id uuid not null references orders(id),
  from_status text,
  to_status text not null,
  actor text not null,            -- system | buyer | seller | webhook
  note text,
  at timestamptz not null default now()
);

create table proofs (             -- what the buyer typed
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  order_id uuid not null references orders(id),
  reference text not null,        -- cleaned before insert
  amount_centavos int not null,
  attested boolean not null default false,  -- the self-check tick
  submitted_at timestamptz not null default now(),
  unique (seller_id, reference)   -- a reference can back one order only
);

create table statement_uploads (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  filename text,
  row_count int,
  covers_until timestamptz,       -- newest payment time in the file
  uploaded_at timestamptz not null default now()
);

create table payments (           -- money the seller actually received
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  source text not null check (source in ('statement', 'paymongo')),
  reference text not null,
  amount_centavos int not null,
  paid_at timestamptz not null,
  order_id uuid references orders(id),       -- known up front for PayMongo
  upload_id uuid references statement_uploads(id),
  unique (seller_id, source, reference)       -- re-uploading a file adds no duplicates
);

create table corrections (        -- seller fixes, reused as LLM examples
  id bigserial primary key,
  seller_id uuid not null references sellers(id),
  message text not null,
  fixed jsonb not null,           -- {intent, item_code, size, qty, for_name}
  created_at timestamptz not null default now()
);
```

**Why it is shaped this way**

- `proofs` and `payments` are separate on purpose. A proof is what the buyer claims; a payment is what the seller's statement or PayMongo says arrived. Verification compares the two.
- The unique rule on `proofs (seller_id, reference)` makes reuse impossible even if two buyers submit at the same second. The backend catches the conflict and turns it into the "reused reference" reason.
- `statement_uploads.covers_until` is what lets the system say Pending instead of Hold when the statement is older than the proof.
- Buyer stats live as counters on `buyers`, so the label (HOLD, WATCH, TRUSTED, NEW) is one quick read.
- Row Level Security: only the backend talks to the database, using the connection string, so the browser never gets database access. Enable RLS on every table with no policies, which blocks the public Supabase API.

## Comment ingestion

Each live session runs as one background task on the backend, not in the browser. The task reads comments from a source (Meta or Replay), broadcasts each raw comment to the screen at once, and hands it to the parser. Both sources yield the same dict, so nothing after this step knows which one is running.

```python
# api/app/sources/meta_live.py
import json
import httpx
from app.config import settings

STREAM = "https://streaming-graph.facebook.com/{vid}/live_comments"

async def meta_comments(live_video_id: str):
    """Yield every new comment on a Facebook live video."""
    params = {
        "access_token": settings.meta_page_token,
        # Check both params against Meta's Live Video API docs in the spike.
        "fields": "from{name,id},message,created_time",
        "comment_rate": "ten_per_second",
    }
    url = STREAM.format(vid=live_video_id)
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("GET", url, params=params) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue                    # skips ": ping" keep-alives
                c = json.loads(line[5:])
                sender = c.get("from") or {}    # may be missing: the spike decides
                yield {
                    "id": c["id"],
                    "user_id": sender.get("id"),
                    "name": sender.get("name", "Viewer"),
                    "message": c.get("message", ""),
                    "created_time": c["created_time"],
                }
```

```python
# api/app/sources/replay.py
import asyncio, json
from datetime import datetime, timezone

def _t(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("+0000", "+00:00"))

async def replay_comments(recording: str, session_id: str, speed: float = 1.0):
    """Play a saved session back with the same gaps between comments."""
    with open(f"recordings/{recording}.jsonl", encoding="utf-8") as f:
        rows = [json.loads(line) for line in f]
    prev = None
    for row in rows:
        t = _t(row["created_time"])
        if prev:
            await asyncio.sleep(max(0, (t - prev).total_seconds()) / speed)
        prev = t
        yield {**row,
               "id": f"{session_id}:{row['id']}",             # unique per replay
               "created_time": datetime.now(timezone.utc).isoformat()}
```

```python
# api/app/sources/runner.py
import asyncio
from app.sources.meta_live import meta_comments
from app.sources.replay import replay_comments
from app.pipeline.cascade import process_comment
from app.hub import hub

RUNNING: dict[str, asyncio.Task] = {}

async def run_session(s: dict):
    if s["source"] == "live":
        src = meta_comments(s["live_video_id"])
    else:
        src = replay_comments(s["live_video_id"], s["id"])
    async for c in src:
        await hub.publish(s["id"], {"type": "comment", "comment": c})
        # Parse in the background so a slow LLM call never stalls the stream.
        asyncio.create_task(process_comment(s["id"], c))

def start(s: dict):
    if s["id"] not in RUNNING:
        RUNNING[s["id"]] = asyncio.create_task(run_session(s))

def stop(session_id: str):
    task = RUNNING.pop(session_id, None)
    if task:
        task.cancel()
```

**How recording works:** every comment is saved in the `comments` table by `process_comment`. `GET /sessions/{id}/export` writes them out as JSON lines, and you commit the best real sessions to `api/recordings/` so Replay works on demo day even if Render restarts. Render's own disk is wiped on every deploy, so never rely on files written there.

**Getting the live video id:** on the seller's Page, start the live, then call `GET /{page-id}/live_videos` with the Page token and take the one whose status is live. If that edge doesn't return it in the spike, create the live through the API and stream to it from OBS (Plan B).

## Parsing cascade

Every comment goes through three steps, cheapest first, and stops at the first one that is sure. Rules are instant and free, RapidFuzz takes about a millisecond, and the LLM is called only for what is left. Anything still unsure lands in the needs-review bucket instead of becoming a wrong order.

| Step | Handles | Stops when |
| --- | --- | --- |
| 1. Rules (regex) | "mine B12", "cancel B3", "mine po" with nothing else | an item code from the catalog is found, or a bare claim (item on camera) |
| 2. RapidFuzz | typos and names: "mine blu polo" | a claim word is present and the best score is 88 or more |
| 3. LLM | Taglish descriptions, "para kay Ana", waitlists, mixed intents | it returns valid JSON with confidence 0.75 or more |
| Needs review | everything below that | the seller fixes it in one tap |

The thresholds (88, 70, 0.75) are starting guesses. Set the real ones from the benchmark.

```python
# api/app/pipeline/rules.py
import re

CLAIM = re.compile(r"\b(mine|mina|minee+|grab|kuha|pa-?mine|pabili|akin)\b", re.I)
CANCEL = re.compile(r"\b(cancel|cancelled|pass|di na|hindi na)\b", re.I)
CODE = re.compile(r"\b([a-z]{1,2})\s?-?(\d{1,3})\b", re.I)     # B12, b 12, B-12
SIZE = re.compile(r"\b(xs|xl|xxl|small|medium|large|s|l)\b", re.I)
QTY = re.compile(r"\b(\d+)\s?(?:pcs?|x)\b|\bx\s?(\d+)\b", re.I)
FILLER = {"po", "ate", "sis", "kuya", "ko", "pls", "please", "yung", "ung", "na"}
SIZES = {"xs": "XS", "s": "S", "small": "S", "medium": "M", "l": "L",
         "large": "L", "xl": "XL", "xxl": "XXL"}

def parse_rules(msg: str, codes: set[str], on_camera: str | None) -> dict | None:
    low = msg.strip().lower()
    code = next((f"{p.upper()}{int(n)}" for p, n in CODE.findall(low)
                 if f"{p.upper()}{int(n)}" in codes), None)
    if CANCEL.search(low):
        return {"intent": "cancel", "item_code": code, "confidence": 1.0 if code else 0.5}
    if low == "m":                                    # a lone "m" means mine
        return {"intent": "claim", "item_code": on_camera, "size": None,
                "qty": 1, "confidence": 0.9 if on_camera else 0.4}
    if not CLAIM.search(low):
        return None                                   # not an obvious order
    size_m = SIZE.search(low)
    qty_m = QTY.search(low)
    qty = int(next(g for g in qty_m.groups() if g)) if qty_m else 1
    if code:
        conf, item = 1.0, code
    else:
        left = set(re.sub(r"[^a-z ]", " ", CLAIM.sub(" ", low)).split()) - FILLER
        if size_m:
            left.discard(size_m.group(1).lower())
        # "mine po" with no other words = the item on camera
        conf, item = (0.9, on_camera) if not left and on_camera else (0.5, None)
    return {"intent": "claim", "item_code": item,
            "size": SIZES.get(size_m.group(1).lower()) if size_m else None,
            "qty": qty, "confidence": conf}
```

Size "M" is left out of the size pattern on purpose: "m" also means "mine". A comment like "m medium" still works, and anything else ambiguous goes to the LLM.

```python
# api/app/pipeline/fuzzy.py
from rapidfuzz import process, fuzz, utils

def build_choices(catalog: list[dict]) -> dict[str, str]:
    """Every name and keyword points to its item code."""
    choices = {}
    for it in catalog:
        choices[it["name"]] = it["code"]
        for kw in it["keywords"]:
            choices[kw] = it["code"]
    return choices

def fuzzy_match(text: str, choices: dict[str, str], limit: int = 10):
    """Best score per item code, highest first: [(code, score), ...]."""
    hits = process.extract(text, list(choices), scorer=fuzz.WRatio,
                           processor=utils.default_process, limit=limit * 3)
    best: dict[str, float] = {}
    for choice, score, _ in hits:
        code = choices[choice]
        best[code] = max(best.get(code, 0), score)
    return sorted(best.items(), key=lambda kv: -kv[1])[:limit]
```

```python
# api/app/pipeline/llm.py
import json
from typing import Literal
import httpx
from pydantic import BaseModel, ValidationError
from app.config import settings

class Parse(BaseModel):
    intent: Literal["claim", "cancel", "waitlist", "question", "other"]
    item_code: str | None = None
    size: str | None = None
    qty: int = 1
    for_name: str | None = None
    confidence: float

SYSTEM = (
    "You read comments from a Filipino Facebook Live selling session. "
    "Comments are in English, Tagalog or Taglish. Decide what the commenter wants. "
    "Only use item codes from the candidates given. If unsure, lower the confidence. "
    'Reply with JSON only: {"intent", "item_code", "size", "qty", "for_name", "confidence"}.'
)

async def llm_parse(message: str, ctx: dict) -> Parse | None:
    user = {
        "comment": message,
        "item_on_camera": ctx["on_camera"],          # {code, name, sizes}
        "recently_shown": ctx["recent_items"],       # last 5 items shown
        "candidates": ctx["candidates"],             # top 10 from RapidFuzz
        "buyer_recent_claims": ctx["buyer_claims"],  # item codes only, no names
        "examples": ctx["examples"],                 # seller corrections
    }
    body = {
        "model": settings.openrouter_model,
        "temperature": 0,
        "response_format": {"type": "json_object"},  # check the model supports it
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": json.dumps(user, ensure_ascii=False)}],
    }
    headers = {"Authorization": f"Bearer {settings.openrouter_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post("https://openrouter.ai/api/v1/chat/completions",
                                  headers=headers, json=body)
            r.raise_for_status()
        p = Parse.model_validate_json(r.json()["choices"][0]["message"]["content"])
    except (httpx.HTTPError, ValidationError, KeyError):
        return None                                  # caller sends it to review
    allowed = {c["code"] for c in ctx["candidates"]} | {ctx["on_camera"]["code"]}
    if p.item_code and p.item_code not in allowed:
        return None                                  # never trust an invented code
    return p
```

**Few-shot examples:** if the seller has 30 or fewer corrections, send them all. Above 30, send the 10 most similar to the comment, picked with the same RapidFuzz call. No vector database is needed at this size.

```python
# api/app/pipeline/cascade.py
from app import db
from app.hub import hub
from app.orders.queue import apply_intent
from app.pipeline.rules import parse_rules
from app.pipeline.fuzzy import build_choices, fuzzy_match
from app.pipeline.llm import llm_parse

ACCEPT, CANDIDATE, REVIEW_BELOW = 88, 70, 0.75

async def process_comment(session_id: str, c: dict):
    s = await db.get_session(session_id)
    catalog = await db.get_catalog(s["seller_id"])
    buyer = await db.upsert_buyer(s["seller_id"], c["user_id"], c["name"])
    await db.insert_comment(session_id, buyer["id"], c)
    on_camera = await db.current_item(s)              # dict or None

    r = parse_rules(c["message"], {i["code"] for i in catalog},
                    on_camera["code"] if on_camera else None)
    stage, result = "rules", r
    if r is None or r["confidence"] < 0.9:
        hits = fuzzy_match(c["message"], build_choices(catalog))
        top_code, top_score = hits[0] if hits else (None, 0)
        if r and r["intent"] == "claim" and top_score >= ACCEPT:
            stage, result = "fuzzy", {**r, "item_code": top_code, "confidence": top_score / 100}
        elif r is not None or top_score >= CANDIDATE:
            ctx = await db.llm_context(s, catalog, buyer, hits, c["message"])
            p = await llm_parse(c["message"], ctx)
            stage, result = "llm", (p.model_dump() if p else None)
        else:
            stage, result = "ignored", None              # chat, greetings, questions

    if stage != "ignored" and (result is None or result["confidence"] < REVIEW_BELOW):
        stage = "review"
    await db.save_parse(c["id"], stage, result)
    if stage not in ("review", "ignored"):
        await apply_intent(s, buyer, c, result)        # see Order states and queue
    await hub.publish(session_id, {"type": "parsed", "comment_id": c["id"],
                                   "stage": stage, "result": result})
```

**When the seller fixes a review item** (`POST /comments/{id}/fix`), the backend saves the fix to `corrections`, then calls the same `apply_intent`. The stage counts from `comments.parse_stage` feed the live scoreboard: rules caught X, AI caught Y more, Z need review.

## Order states and queue

An order can only move along the arrows below, and every move is one guarded database update. If two things try to move the same order at once, only one wins, and the other gets nothing back instead of corrupting the order.

&#91;embedded content: order states · 7 main, 2 end\]

The queue moves orders between CLAIMED and WAITLISTED by itself; every other arrow is a person or a webhook acting. PROOF\_SENT can be cancelled but never expires, because the buyer has already done their part.

```python
# api/app/orders/states.py
from app import db
from app.hub import hub

ALLOWED = {
    "CLAIMED":    {"CONFIRMED", "WAITLISTED", "EXPIRED", "CANCELLED"},
    "WAITLISTED": {"CLAIMED", "EXPIRED", "CANCELLED"},
    "CONFIRMED":  {"PROOF_SENT", "EXPIRED", "CANCELLED"},
    "PROOF_SENT": {"VERIFIED", "CONFIRMED", "CANCELLED"},  # back to CONFIRMED = proof rejected
    "VERIFIED":   {"PACKED"},
    "PACKED":     {"SHIPPED"},
}

def sources_of(to: str) -> list[str]:
    return [s for s, nxt in ALLOWED.items() if to in nxt]

async def transition(order_id: str, to: str, actor: str, note: str | None = None, **fields):
    """Move one order. Returns the updated row, or None if the move is not allowed now."""
    sets = ", ".join(f"{k} = %({k})s" for k in fields)
    sql = f"""
      with old as (select status from orders where id = %(id)s for update)
      update orders o set status = %(to)s, updated_at = now() {', ' + sets if sets else ''}
      from old
      where o.id = %(id)s and old.status = any(%(froms)s)
      returning o.*, old.status as from_status"""
    row = await db.fetchone(sql, {"id": order_id, "to": to, "froms": sources_of(to), **fields})
    if row:
        await db.execute("insert into order_events (order_id, from_status, to_status, actor, note) "
                         "values (%s, %s, %s, %s, %s)", (order_id, row["from_status"], to, actor, note))
        await hub.publish(row["session_id"], {"type": "order", "order": db.public(row)})
    return row
```

**Queue rule (who gets the item):** an item has `stock` units for the live. Orders that are CONFIRMED or later keep their unit. The remaining units go to CLAIMED and WAITLISTED orders sorted by comment time, earliest first. `rebalance` re-runs that rule whenever a claim arrives, a claim is cancelled or a claim expires. Because it sorts by Meta's comment time and not by processing time, a comment that waited longer for the LLM still gets its fair place ("ako nauna" is settled by the timestamp). It never takes a unit away from a confirmed buyer.

```python
# api/app/orders/queue.py
import asyncio, secrets
from datetime import timedelta
from app import db
from app.orders.states import transition

HOLD = timedelta(minutes=15)      # time to confirm a claim
PAY_WINDOW = timedelta(hours=24)  # time to pay after confirming (seller setting later)
ACTIVE = ("CLAIMED", "WAITLISTED")
LOCKED = ("CONFIRMED", "PROOF_SENT", "VERIFIED", "PACKED", "SHIPPED")

async def apply_intent(s: dict, buyer: dict, c: dict, r: dict):
    if r["intent"] in ("claim", "waitlist") and r["item_code"]:
        item = await db.item_by_code(s["seller_id"], r["item_code"])
        await db.insert_order(
            seller_id=s["seller_id"], session_id=s["id"], buyer_id=buyer["id"],
            item_id=item["id"], comment_id=c["id"], size=r.get("size"),
            qty=r.get("qty", 1), total_centavos=item["price_centavos"] * r.get("qty", 1),
            status="WAITLISTED", claimed_at=c["created_time"],
            buyer_token=secrets.token_urlsafe(16))
        await db.bump_buyer(buyer["id"], claims=1)
        await rebalance(item["id"])
    elif r["intent"] == "cancel":
        o = await db.latest_open_order(buyer["id"], s["id"], r.get("item_code"))
        if o and await transition(o["id"], "CANCELLED", "buyer", "cancelled in comments"):
            await db.bump_buyer(buyer["id"], cancels=1)
            await rebalance(o["item_id"])

async def rebalance(item_id: str):
    async with db.tx() as conn:
        item = await conn.fetchone("select * from catalog_items where id = %s for update", (item_id,))
        locked = await conn.fetchval("select count(*) from orders where item_id = %s "
                                     "and status = any(%s)", (item_id, list(LOCKED)))
        free = max(item["stock"] - locked, 0)
        waiting = await conn.fetch("select id, status from orders where item_id = %s "
                                   "and status = any(%s) order by claimed_at", (item_id, list(ACTIVE)))
    for i, o in enumerate(waiting):
        want = "CLAIMED" if i < free else "WAITLISTED"
        if o["status"] != want:
            extra = {"hold_until": db.now() + HOLD} if want == "CLAIMED" else {}
            await transition(o["id"], want, "system", "queue", **extra)

async def confirm(order: dict, size: str | None, qty: int | None):
    """Buyer taps Confirm on the private link, optionally fixing size or qty."""
    fields = {"pay_by": db.now() + PAY_WINDOW}
    if size:
        fields["size"] = size
    if qty:
        fields["qty"], fields["total_centavos"] = qty, order["total_centavos"] // order["qty"] * qty
    return await transition(order["id"], "CONFIRMED", "buyer", "confirmed on link", **fields)

async def expiry_loop():
    """Started on app startup. Expires late claims and unpaid orders every 30 s."""
    while True:
        rows = await db.fetch("select id, item_id, buyer_id, status from orders where "
                              "(status = 'CLAIMED' and hold_until < now()) or "
                              "(status = 'CONFIRMED' and pay_by < now())")
        for o in rows:
            if await transition(o["id"], "EXPIRED", "system", "deadline passed"):
                if o["status"] == "CONFIRMED":
                    await db.bump_buyer(o["buyer_id"], expired_unpaid=1)
                await rebalance(o["item_id"])
        await asyncio.sleep(30)
```

**Buyer labels** are computed on read from the counters, never stored:

```python
def label(b: dict) -> str:
    if b["failed_proofs"] >= 1 or b["expired_unpaid"] >= 3:
        return "HOLD"
    if b["claims"] >= 3 and (b["expired_unpaid"] + b["cancels"]) / b["claims"] >= 0.34:
        return "WATCH"
    if b["verified"] >= 3 and b["failed_proofs"] == 0:
        return "TRUSTED"
    return "NEW"
```

The 15-minute hold and 24-hour pay window are demo defaults. Ask sellers what they use today and make both seller settings later.

## Payment verification

The check is one pure function that gets everything it needs passed in and returns Release, Hold or Pending with reasons. It never reads a screenshot and never moves the order by itself: the seller's tap does that. Payment data comes from two sources that write the same `payments` table: the statement upload (default) and the PayMongo webhook (optional).

**Flow:** buyer submits proof, then `run_check`. Seller uploads a statement, then `run_check` again for every order still in PROOF\_SENT. Seller taps Release (to VERIFIED) or Reject (back to CONFIRMED so the buyer can resubmit).

```python
# api/app/payments/statement.py
import csv, io, re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

# Column names differ per wallet and bank. Fill these from a real export.
REF_COLS = {"reference no.", "reference number", "ref no", "reference", "transaction id"}
AMT_COLS = {"amount", "credit", "amount (php)"}
TIME_COLS = {"date", "date and time", "transaction date"}
TIME_FORMATS = ("%Y-%m-%d %H:%M:%S", "%m/%d/%Y %I:%M %p", "%Y-%m-%dT%H:%M:%S")
MANILA = ZoneInfo("Asia/Manila")

def clean_ref(s: str) -> str:
    """'1234 567-890' -> '1234567890'"""
    return re.sub(r"[^0-9A-Za-z]", "", s).upper()

def to_centavos(s: str) -> int:
    s = s.replace("₱", "").replace("PHP", "").replace(",", "").strip()
    try:
        return int((Decimal(s) * 100).quantize(Decimal("1")))
    except InvalidOperation:
        raise ValueError(f"bad amount: {s!r}")

def parse_time(s: str) -> datetime:
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(s.strip(), fmt).replace(tzinfo=MANILA)
        except ValueError:
            pass
    raise ValueError(f"unknown date format: {s!r}")

def _col(header: list[str], names: set[str]) -> int:
    for i, h in enumerate(header):
        if h.strip().lower() in names:
            return i
    raise ValueError(f"statement is missing a column like {sorted(names)}")

def parse_statement(raw: bytes) -> list[dict]:
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    head = rows[0]
    ri, ai, ti = _col(head, REF_COLS), _col(head, AMT_COLS), _col(head, TIME_COLS)
    out = []
    for r in rows[1:]:
        if len(r) <= max(ri, ai, ti) or not r[ri].strip():
            continue
        amount = to_centavos(r[ai])
        if amount <= 0:
            continue                      # money in only
        out.append({"reference": clean_ref(r[ri]), "amount_centavos": amount,
                    "paid_at": parse_time(r[ti])})
    return out
```

```python
# api/app/payments/verify.py
from dataclasses import dataclass, field
from datetime import datetime, timedelta

@dataclass
class Result:
    decision: str                     # RELEASE | HOLD | PENDING
    reasons: list[str] = field(default_factory=list)
    suggestion: str | None = None     # "did you mean ..." for the seller only

def peso(c: int) -> str:
    return f"₱{c / 100:,.2f}"

def verify_payment(order: dict, proof: dict | None, payment: dict | None,
                   reused_by: str | None, statement_until: datetime | None,
                   buyer: dict, near_ref: str | None = None) -> Result:
    """
    order:   total_centavos, claimed_at
    proof:   reference, amount_centavos, submitted_at (what the buyer typed)
    payment: the payments row with the same reference, or None
    reused_by: another order id that already holds this reference, or None
    statement_until: newest payment time covered by uploads, or None
    buyer:   max_paid_centavos
    """
    if not proof or not proof["reference"]:
        return Result("HOLD", ["missing reference"])
    hard, soft = [], []
    if reused_by:
        hard.append("reused reference: already used on another order")
    if payment is None:
        statement_is_older = statement_until is None or proof["submitted_at"] > statement_until
        if statement_is_older and not hard:
            return Result("PENDING", ["waiting for a newer statement"])
        if not statement_is_older:
            hard.append("reference not in your statement")
    else:
        if payment["amount_centavos"] != order["total_centavos"]:
            hard.append(f"amount mismatch: paid {peso(payment['amount_centavos'])}, "
                        f"order {peso(order['total_centavos'])}")
        if payment["paid_at"] < order["claimed_at"] - timedelta(minutes=5):
            hard.append("payment is older than the order")   # an old real transfer reused
    top = buyer["max_paid_centavos"]
    if top and order["total_centavos"] > 3 * top:
        soft.append("unusual size: over 3x this buyer's biggest paid order")
    if hard or soft:
        return Result("HOLD", hard + soft, suggestion=near_ref)
    return Result("RELEASE", ["reference found, amount matches"])
```

Every check runs and every reason found is returned, so the seller sees all problems at once. "Payment is older than the order" catches a buyer reusing an old genuine transfer that never went through our system.

```python
# api/app/payments/service.py (glue around the pure function)
from psycopg.errors import UniqueViolation
from rapidfuzz import process, fuzz
from app import db
from app.hub import hub
from app.orders.states import transition
from app.payments.statement import clean_ref, parse_statement
from app.payments.verify import verify_payment

async def submit_proof(order: dict, reference: str, amount_centavos: int, attested: bool):
    ref = clean_ref(reference)
    try:
        await db.insert_proof(order["seller_id"], order["id"], ref, amount_centavos, attested)
    except UniqueViolation:
        pass                              # run_check reports it as reused
    await transition(order["id"], "PROOF_SENT", "buyer", "proof submitted")
    await run_check(order["id"])

async def run_check(order_id: str):
    o = await db.get_order(order_id)
    proof = await db.latest_proof(order_id)
    owner = await db.proof_owner(o["seller_id"], proof["reference"]) if proof else None
    payment = await db.payment_by_ref(o["seller_id"], proof["reference"]) if proof else None
    near = None
    if proof and payment is None:
        refs = await db.unmatched_refs(o["seller_id"])
        hit = process.extractOne(proof["reference"], refs, scorer=fuzz.ratio, score_cutoff=90)
        near = hit[0] if hit else None
    res = verify_payment(o, proof, payment,
                         reused_by=owner if owner and owner != order_id else None,
                         statement_until=await db.statement_until(o["seller_id"]),
                         buyer=await db.get_buyer(o["buyer_id"]), near_ref=near)
    await db.set_verdict(order_id, res.decision, res.reasons)
    await hub.publish(o["session_id"], {"type": "verdict", "order_id": order_id,
                                        "decision": res.decision, "reasons": res.reasons,
                                        "suggestion": res.suggestion})

async def upload_statement(seller_id: str, filename: str, raw: bytes) -> int:
    rows = parse_statement(raw)
    upload_id = await db.insert_upload(seller_id, filename, len(rows),
                                       max((r["paid_at"] for r in rows), default=None))
    await db.insert_payments(seller_id, "statement", rows, upload_id)  # on conflict do nothing
    for oid in await db.order_ids_in_status(seller_id, "PROOF_SENT"):
        await run_check(oid)              # this is the live "flip" in the demo
    return len(rows)

async def seller_release(order_id: str):
    o = await transition(order_id, "VERIFIED", "seller", "released")
    if o:
        await db.bump_buyer(o["buyer_id"], verified=1, paid_centavos=o["total_centavos"])

async def seller_reject(order_id: str, reason: str):
    o = await transition(order_id, "CONFIRMED", "seller", f"proof rejected: {reason}")
    if o:
        await db.bump_buyer(o["buyer_id"], failed_proofs=1)
```

**Optional: Instant QR with PayMongo (test mode).** Build this only after the manual flow works end to end, and only if the one-hour spike passes. The webhook check below follows the signature scheme as I understand it: confirm the header name, the signed string and the payload paths against PayMongo's webhook docs before relying on it.

```python
# api/app/payments/paymongo.py
import hashlib, hmac, json
from fastapi import APIRouter, HTTPException, Request
from app import db
from app.config import settings
from app.orders.states import transition
from app.payments.service import run_check

router = APIRouter()

def valid_signature(header: str, raw: bytes) -> bool:
    # Expected shape: "t=<timestamp>,te=<test signature>,li=<live signature>"
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    signed = f"{parts.get('t', '')}.{raw.decode()}".encode()
    mac = hmac.new(settings.paymongo_webhook_secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, parts.get("te", ""))   # test mode signature

@router.post("/webhooks/paymongo")
async def paymongo_webhook(request: Request):
    raw = await request.body()
    if not valid_signature(request.headers.get("Paymongo-Signature", ""), raw):
        raise HTTPException(401, "bad signature")
    event = json.loads(raw)["data"]["attributes"]
    if event["type"] == "payment.paid":
        pay = event["data"]
        order_id = pay["attributes"]["metadata"]["order_id"]   # set when the QR is created
        o = await db.get_order(order_id)
        await db.insert_payments(o["seller_id"], "paymongo", [{
            "reference": pay["id"], "amount_centavos": pay["attributes"]["amount"],
            "paid_at": db.now(), "order_id": order_id}], None)
        await db.insert_proof(o["seller_id"], order_id, pay["id"],
                              pay["attributes"]["amount"], True)
        await transition(order_id, "PROOF_SENT", "webhook", "PayMongo payment.paid")
        await run_check(order_id)
    elif event["type"] == "qrph.expired":
        pass                              # buyer page offers "get a new QR"
    return {"ok": True}                   # retries are safe: payments are unique
```

Creating the QR itself (`create_qr(order)`) is left as a stub until the spike: read PayMongo's QR Ph API guide for the exact calls, put `order_id` in the payment's metadata, and return the QR image plus `test_url`. In test mode, never scan the code with a real wallet app; approve it on the `test_url` page.

## Realtime updates and app wiring

The seller screen loads a snapshot once (`GET /sessions/{id}/board`), then applies events from one SSE stream. If the connection drops, the browser reconnects by itself and the screen reloads the snapshot, so nothing is missed. The buyer page polls its own order every 3 seconds, which is enough for the Instant QR flip and much simpler than a second stream.

```python
# api/app/hub.py
import asyncio
from collections import defaultdict

class Hub:
    """In-memory fan-out. Fine for one Render instance; use Supabase Realtime or Redis if you ever run two."""
    def __init__(self):
        self.subs: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, key: str) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=500)
        self.subs[key].add(q)
        return q

    def unsubscribe(self, key: str, q: asyncio.Queue):
        self.subs[key].discard(q)

    async def publish(self, key: str, event: dict):
        for q in list(self.subs[key]):
            if not q.full():              # a frozen tab must never slow the live
                q.put_nowait(event)

hub = Hub()
```

```python
# api/app/routers/stream.py
import asyncio, json
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.auth import seller_only
from app.hub import hub

router = APIRouter()

@router.get("/sessions/{sid}/stream", dependencies=[Depends(seller_only)])
async def stream(sid: str, request: Request):
    q = hub.subscribe(sid)

    async def events():
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev, default=str, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"     # keeps proxies from closing the stream
        finally:
            hub.unsubscribe(sid, q)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

```python
# api/app/auth.py
from fastapi import Header, HTTPException, Query
from app.config import settings

def seller_only(x_seller_key: str | None = Header(None), key: str | None = Query(None)):
    # EventSource can't send headers, so the stream passes the key as ?key=
    if (x_seller_key or key) != settings.seller_key:
        raise HTTPException(401, "seller key required")
```

```python
# api/app/db.py (the helpers everything else calls)
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from app.config import settings

# prepare_threshold=None keeps psycopg working behind Supabase's transaction pooler
pool = AsyncConnectionPool(settings.database_url, min_size=1, max_size=5, open=False,
                           kwargs={"row_factory": dict_row, "prepare_threshold": None})

def now() -> datetime:
    return datetime.now(timezone.utc)

class Conn:
    def __init__(self, conn): self.c = conn
    async def fetch(self, sql, args=None):
        return await (await self.c.execute(sql, args)).fetchall()
    async def fetchone(self, sql, args=None):
        return await (await self.c.execute(sql, args)).fetchone()
    async def fetchval(self, sql, args=None):
        row = await self.fetchone(sql, args)
        return next(iter(row.values())) if row else None
    async def execute(self, sql, args=None):
        await self.c.execute(sql, args)

@asynccontextmanager
async def tx():
    async with pool.connection() as conn, conn.transaction():
        yield Conn(conn)

async def fetch(sql, args=None):
    async with tx() as c:
        return await c.fetch(sql, args)

async def fetchone(sql, args=None):
    async with tx() as c:
        return await c.fetchone(sql, args)

async def execute(sql, args=None):
    async with tx() as c:
        await c.execute(sql, args)

# Plus one small named function per query used above (get_order, insert_proof,
# bump_buyer, payment_by_ref, ...). Keep each one a single SQL statement.
```

```python
# api/app/main.py
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app import db
from app.config import settings
from app.orders.queue import expiry_loop
from app.payments import paymongo
from app.routers import sessions, orders, buyer, payments, catalog, stream

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.pool.open()
    loop = asyncio.create_task(expiry_loop())
    yield
    loop.cancel()
    await db.pool.close()

app = FastAPI(title="Live Seller API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[settings.web_origin],
                   allow_methods=["*"], allow_headers=["*"])
for r in (sessions, orders, buyer, payments, catalog, stream):
    app.include_router(r.router)
if settings.paymongo_secret_key:
    app.include_router(paymongo.router)

@app.get("/health")
async def health():
    return {"ok": True}
```

```ts
// web/src/useEventStream.ts
import { useEffect, useRef } from "react";

export type LiveEvent =
  | { type: "comment"; comment: Comment }
  | { type: "parsed"; comment_id: string; stage: string; result: Parse | null }
  | { type: "order"; order: Order }
  | { type: "verdict"; order_id: string; decision: string; reasons: string[]; suggestion?: string };

export function useEventStream(sessionId: string, onEvent: (e: LiveEvent) => void,
                               onReconnect: () => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;                      // always call the latest handler
  useEffect(() => {
    const url = `${import.meta.env.VITE_API_URL}/sessions/${sessionId}/stream` +
                `?key=${import.meta.env.VITE_SELLER_KEY}`;
    const es = new EventSource(url);
    es.onmessage = (m) => handler.current(JSON.parse(m.data));
    es.onopen = () => onReconnect();              // reload the snapshot after any drop
    return () => es.close();
  }, [sessionId]);
}
```

The board keeps one `useReducer` keyed by order id: `order` events replace a card, `verdict` events update its badge, `parsed` events move a comment into the right column of the scoreboard. A `VITE_` variable ends up in the browser bundle, so the seller key is a demo key only, not real security.

## API endpoints

Twenty routes in three groups: seller routes need the seller key, buyer routes need only the order's private token, and the webhook needs PayMongo's signature. FastAPI also generates live docs for all of them at `/docs`, which is handy to show judges.

| Method | Path | Caller | What it does |
| --- | --- | --- | --- |
| GET | `/health` | anyone | Wake-up and uptime check |
| POST | `/sessions` | seller | Create a session: `source` (live or replay) + live video id or recording name |
| POST | `/sessions/{id}/start` | seller | Start the background reader for that session |
| POST | `/sessions/{id}/stop` | seller | Stop it |
| PUT | `/sessions/{id}/on-camera` | seller | Set the item on camera (`{item_code}`), used by "mine po" |
| GET | `/sessions/{id}/board` | seller | Snapshot: items and their queues, orders, review bucket, scoreboard |
| GET | `/sessions/{id}/stream` | seller | SSE stream of comment, parsed, order and verdict events |
| GET | `/sessions/{id}/export` | seller | Download the session's comments as JSON lines for Replay |
| GET, POST | `/catalog` | seller | List or add items |
| PUT | `/catalog/{code}` | seller | Edit price, stock, sizes, keywords |
| POST | `/comments/{id}/fix` | seller | Fix a review item; saves a correction and applies it |
| GET | `/buyer/{token}` | buyer | Order summary, seller payment details, status, deadline |
| POST | `/buyer/{token}/confirm` | buyer | Confirm the order, optionally fixing size or qty |
| POST | `/buyer/{token}/proof` | buyer | `{reference, amount, attested}` after the self-check |
| POST | `/buyer/{token}/qr` | buyer | Optional: create a PayMongo QR for this order |
| POST | `/payments/statement` | seller | Upload a statement CSV (multipart); re-checks every PROOF\_SENT order |
| POST | `/orders/{id}/release` | seller | Release: to VERIFIED, buyer stats updated |
| POST | `/orders/{id}/reject` | seller | Reject proof with a reason: back to CONFIRMED |
| POST | `/orders/{id}/pack`, `/ship` | seller | Packing list checkboxes |
| POST | `/webhooks/paymongo` | PayMongo | Optional: `payment.paid` and `qrph.expired` events |

**Buyer page rules:** it shows the buyer only their own order, never other buyers' names. When the order is on Hold it says "the seller is checking your payment" and leaves the reasons to the seller's screen, so a buyer is never accused on screen by the system. Buyer tokens come from `secrets.token_urlsafe(16)` (128 random bits), so they can't be guessed.

## Frontend

Six screens: five for the seller on a laptop, and one for the buyer on a phone. The live board is the demo's main screen, so it is built first and designed to be read on a projector.

| Route | Screen | What is on it |
| --- | --- | --- |
| `/seller/sessions` | Sessions | Start a live (paste the live video id) or a replay (pick a recording, speed 1x to 4x) |
| `/seller/live/:sessionId` | Live board | Left: raw comment feed, each line tagged rules, AI, review or ignored. Center: one card per item with its queue (claimed, waitlist) and a "Set on camera" button. Right: review bucket and scoreboard |
| `/seller/payments` | Payments | Statement upload, then orders in PROOF\_SENT with a badge (Release recommended, Hold with reasons, Pending), Release and Reject buttons, and "Release all green" |
| `/seller/packing` | Packing list | VERIFIED orders grouped by buyer, with Packed and Shipped checkboxes and session totals |
| `/seller/catalog` | Catalog | Item table: code, photo, name, price, sizes, stock, keywords |
| `/o/:token` | Buyer order | Mobile page that changes with the order state (below) |

**Buyer page by state**

- CLAIMED: item photo, name, size, qty, total, a countdown to `hold_until`, editable size and qty, one Confirm button.
- WAITLISTED: "You are number N in line"; it becomes CLAIMED by itself if someone ahead drops.
- CONFIRMED (Manual): seller's payment details, the pay-by time, then the self-check list (status says successful, amount matches, recipient is the seller), the reference field and the "I checked this payment in my app" tick.
- CONFIRMED (Instant QR): the QR image with a 30-minute countdown and "Get a new QR" after it expires.
- PROOF\_SENT: "The seller is checking your payment."
- VERIFIED, PACKED, SHIPPED: a simple status line.
- EXPIRED or CANCELLED: what happened and nothing to click.

**Components:** `OrderCard`, `ItemQueue`, `CommentFeed`, `ReviewBucket` (the fix form: intent, item, size, qty), `Scoreboard`, `VerdictBadge`, `StatementUpload`, `BuyerSteps`.

**Design rules**

- Every status shows a word, not only a color ("HOLD: amount mismatch"), so it reads on a projector and for color-blind judges.
- Amounts always show as pesos with two decimals from centavos (`₱850.00`), formatted in one helper.
- Buyer names are masked on the board ("Ana R.") because the screen is projected (RA 10173).
- Use Filipino seed data: Jessa's ukay shop in Tondo, items B1 to B20, buyer names like Ana Reyes and Mark Dela Cruz, prices like ₱150 to ₱850.

## Security and privacy

The rule is simple: secrets stay on the backend, the browser gets only what its screen shows, and we keep the least buyer data that still makes an order work.

| Risk | What we do |
| --- | --- |
| Meta Page token leaks | Only the backend reads it (httpx), from a Render env variable. The browser never sees it |
| LLM key leaks | Same: OpenRouter is called only from the backend |
| Someone opens another buyer's order | Buyer links use a 128-bit random token; the page shows that one order only |
| Fake PayMongo webhook | Check the signature on every call; reject anything that fails |
| Webhook sent twice | `payments` is unique on (seller, source, reference), so a retry adds nothing |
| One reference used for two orders | Unique rule on `proofs (seller_id, reference)` |
| Direct database access | RLS on with no policies, so the public Supabase API returns nothing; only the backend's connection string works |
| Seller screens open to anyone | Demo seller key in a header. Real login is out of scope and said so in the README |
| Wrong order from a bad parse | Low-confidence parses go to review; the buyer confirms every order before it counts |

**Data privacy (RA 10173)**

- Store only what an order needs: Meta user id, display name, the comment text, order and payment details. No addresses, phone numbers or account numbers.
- Buyer names are masked on the projected board.
- The LLM gets the comment, item codes and the buyer's recent item codes, never the buyer's name or Meta id. Pick OpenRouter providers that don't keep or train on prompts (check OpenRouter's provider privacy settings).
- Buyer history stays inside one seller's account. No shared blacklist across sellers.
- Add a delete-my-data route for the seller (wipe a buyer's rows) and mention it in the pitch.

## Deployment

Three free services, one deploy each, all from the same GitHub repo. Deploy a "hello world" version of all three in the first hours so demo day never depends on a first deploy.

1. **Supabase:** create the project (pick the Singapore region if offered), run `supabase/schema.sql` in the SQL editor, load the seed SQL, and copy the pooler connection string into `DATABASE_URL`.
2. **Render (backend):** new Web Service from the repo, root directory `api`, build command `pip install -r requirements.txt`, start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Add the env variables. Run one instance only, because the SSE hub lives in memory.
3. **Vercel (frontend):** import the repo, root directory `web`, framework Vite, env `VITE_API_URL` and `VITE_SELLER_KEY`. Add the rewrite below as web/vercel.json so `/o/:token` still works when a buyer refreshes the page.
4. **Meta:** app in development mode with team members given roles. Get the Page token: short-lived user token, exchange for a long-lived one (`oauth/access_token?grant_type=fb_exchange_token`), then read the Page token from `/me/accounts`.
5. **PayMongo (optional):** register `https://<render-url>/webhooks/paymongo` for `payment.paid` and `qrph.expired`, and copy the webhook secret into Render.

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Statement uploads go straight to Render, not through Vercel, so Vercel's 4.5 MB request body limit doesn't apply.

**Render free tier:** it sleeps after 15 minutes idle and takes about a minute to wake. While a live runs it stays awake. Before every demo or judging slot, open `/health` and wait for `{"ok": true}`.

**Demo-day checklist**

- [ ] `/health` returns ok 2 minutes before going up
- [ ] Best real recording committed in `api/recordings/` and Replay tested at 2x
- [ ] Phone hotspot ready if venue Wi-Fi drops
- [ ] Statement CSV for the demo orders ready on the laptop
- [ ] Buyer link tested on a real phone
- [ ] QR for judges to comment printed or on a slide
- [ ] Browser zoom set so the board reads from the back of the room

## Testing and the Taglish benchmark

Two kinds of tests: unit tests that prove the plain-code parts are right, and a benchmark that measures how much the AI adds. The benchmark result is the key slide, because it answers "why AI?" with a number instead of a claim.

**Unit tests (pytest).** `verify_payment` is a pure function, so its tests are a table of cases. Each case is also a sentence you can say in Q&A.

```python
# api/tests/test_verify.py
from datetime import datetime, timedelta, timezone
import pytest
from app.payments.verify import verify_payment

T0 = datetime(2026, 10, 23, 20, 0, tzinfo=timezone.utc)
ORDER = {"total_centavos": 85000, "claimed_at": T0}
BUYER = {"max_paid_centavos": 50000}
UNTIL = T0 + timedelta(hours=1)

def proof(ref="1234567890", at=T0 + timedelta(minutes=10)):
    return {"reference": ref, "amount_centavos": 85000, "submitted_at": at}

def pay(amt=85000, at=T0 + timedelta(minutes=8)):
    return {"amount_centavos": amt, "paid_at": at}

CASES = [
    # name, proof, payment, reused_by, statement_until, buyer, decision, reasons start with
    ("clean match", proof(), pay(), None, UNTIL, BUYER, "RELEASE", []),
    ("missing reference", proof(ref=""), None, None, UNTIL, BUYER, "HOLD", ["missing reference"]),
    ("reused reference", proof(), pay(), "order-2", UNTIL, BUYER, "HOLD", ["reused reference"]),
    ("not in statement", proof(), None, None, UNTIL, BUYER, "HOLD", ["reference not in"]),
    ("statement too old", proof(), None, None, T0, BUYER, "PENDING", ["waiting for"]),
    ("no statement yet", proof(), None, None, None, BUYER, "PENDING", ["waiting for"]),
    ("amount mismatch", proof(), pay(amt=45000), None, UNTIL, BUYER, "HOLD", ["amount mismatch"]),
    ("old transfer reused", proof(), pay(at=T0 - timedelta(days=2)), None, UNTIL, BUYER,
     "HOLD", ["payment is older"]),
    ("3x spike", proof(), pay(), None, UNTIL, {"max_paid_centavos": 20000}, "HOLD", ["unusual size"]),
    ("new buyer, no spike rule", proof(), pay(), None, UNTIL, {"max_paid_centavos": 0}, "RELEASE", []),
]

@pytest.mark.parametrize("name,pf,pm,reused,until,buyer,decision,starts", CASES)
def test_verify(name, pf, pm, reused, until, buyer, decision, starts):
    r = verify_payment(ORDER, pf, pm, reused, until, buyer)
    assert r.decision == decision, name
    for s in starts:
        assert any(x.startswith(s) for x in r.reasons), (name, r.reasons)
```

```python
# api/tests/test_rules.py
from app.pipeline.rules import parse_rules
CODES = {"B1", "B3", "B12"}

def test_item_code():       assert parse_rules("mine B12", CODES, None)["item_code"] == "B12"
def test_bare_claim():      assert parse_rules("mine po", CODES, "B3")["item_code"] == "B3"
def test_lone_m():          assert parse_rules("m", CODES, "B1")["item_code"] == "B1"
def test_cancel():          assert parse_rules("cancel B12 po", CODES, None)["intent"] == "cancel"
def test_chat_ignored():    assert parse_rules("hello ate ganda", CODES, "B1") is None
def test_description():     assert parse_rules("mine yung blue po", CODES, "B1")["confidence"] == 0.5
def test_size_and_qty():
    r = parse_rules("mine B12 large 2pcs", CODES, None)
    assert (r["size"], r["qty"]) == ("L", 2)
```

**Taglish benchmark.** The business team builds `bench/comments.csv`: 100 comments in the style of real Filipino lives, each labeled by hand. Real comments copied from public lives must have names removed.

| Column | Example |
| --- | --- |
| `message` | `pa mine po yung blue na polo, M sana` |
| `on_camera` | `B7` |
| `gold_intent` | `claim` |
| `gold_item` | `B4` |
| `gold_size` | `M` |
| `gold_qty` | `1` |

`bench/run_bench.py` runs the same 100 comments through four setups and prints one row each: rules only, rules + RapidFuzz, rules + RapidFuzz + LLM, and the same with seller corrections as examples. A comment counts as right when intent and item both match the label. For the corrections setup, use 30 comments as the examples and score the other 70, so the test never grades the examples it learned from.

| Setup | Right (%) | Sent to review (%) | Wrong order made (%) | Avg time per comment |
| --- | --- | --- | --- | --- |
| Rules only | run it | run it | run it | run it |
| + RapidFuzz | run it | run it | run it | run it |
| + LLM | run it | run it | run it | run it |
| + corrections | run it | run it | run it | run it |

"Wrong order made" matters most: a comment sent to review costs the seller a tap, but a wrong order costs her a sale. Fill the table only with numbers the script prints, then use it to set the 88 / 70 / 0.75 thresholds and to pick the OpenRouter model.

## Build plan

About 28 hours of dev work for the demo and 35 with the extras, for one developer, which is close to all the time before the Day 2 deadline, so the order matters: each step leaves a working demo, and everything below the cut line can be dropped. Replay comes before the real Meta stream, so the board works even if the spike fails.

| # | Block | Hours | Owner | Done when |
| --- | --- | --- | --- | --- |
| 1 | Meta spike: `from` field, non-tester comments, `live_videos` edge | 1.5 | Ethan | One real comment with a sender id prints in the terminal |
| 2 | Skeleton: repo, schema, `/health` on Render, Vite on Vercel | 1.5 | Ethan | Vercel page shows the Render health check |
| 3 | Replay source, hub, SSE stream, comment feed | 4 | Ethan | A recording plays into the board in real time |
| 4 | Rules, RapidFuzz, order states, queue, expiry | 5 | Ethan | "mine B12" makes a CLAIMED order; a cancel promotes the waitlist |
| 5 | Buyer link page and confirm | 3 | Ethan | Phone opens the link, confirms, the board updates |
| 6 | Statement parser, verify\_payment, Payments screen, unit tests | 5 | Ethan | Uploading the demo CSV flips orders to Release or Hold live |
| 7 | LLM step, review bucket, corrections | 4 | Ethan | Taglish comments parse; fixes appear as examples |
| 8 | Packing list, seed data, real Meta source switched on | 2 | Ethan | Full demo runs end to end |
| 9 | Run benchmark, set thresholds, pick model | 2 | Ethan + Business 1 | The results table is filled |
|  | **Cut line: everything above is the demo** |  |  |  |
| 10 | PayMongo spike, then Instant QR if it passes | 1 + 3 | Ethan | Test payment flips an order with no click |
| 11 | Polish, README with citations, demo video | 3 | All | Video uploaded with repo and deck |

**Business team, in parallel**

- **Business 1:** label the 100 benchmark comments by the end of Day 1, so step 9 isn't waiting.
- **Business 2:** seed data (20 catalog items with photos you own or are free to use, Filipino buyer names, prices), a demo statement CSV that matches the demo orders, and a real GCash or bank export sample from a seller (account numbers removed).
- **Business 3:** 5 to 10 seller interviews (claims per live, how many never pay, hours after the live), then the deck and the video script.
- **Everyone:** test the buyer link on your own phones once step 5 lands, and learn the demo script in the CSSprint Ideas doc.

**If behind schedule, cut in this order:** Instant QR, the Catalog screen (seed with SQL), the corrections-as-examples feature, the real Meta stream (demo with Replay and say so). Never cut the payment check or the review bucket: they are the product.

## Open questions for the spikes

Each of these changes code above, so answer them before building the part that depends on them.

- [ ] **Meta:** does each live comment include `from` (sender id and name) in development mode? Do comments from people with no role on the app come through at all? (step 1)
- [ ] **Meta:** are `fields` and `comment_rate` the right parameters for `live_comments`, and does `/{page-id}/live_videos` return the running live? (step 1)
- [ ] **Statement:** real column names and date format for GCash, Maya and the main banks. Fill `REF_COLS`, `AMT_COLS`, `TIME_FORMATS` from a real sample (Business 2)
- [ ] **PayMongo:** exact calls to create a QR Ph payment, where `order_id` goes in metadata, whether `payment.paid` fires when the `test_url` is approved, the amount unit, and the webhook signature format (step 10)
- [ ] **OpenRouter:** which model returns valid JSON reliably, fast enough for a live, and runs on providers that don't keep prompts (step 9)
- [ ] **Supabase:** confirm psycopg works on the pooler URL with `prepare_threshold=None`, or switch to the session pooler (step 2)
- [ ] **Sellers:** what hold time and pay window they use today, to replace the 15-minute and 24-hour defaults (Business 3)

## Libraries and APIs to cite

The hackathon rules require citing every third-party library, API and dataset. Copy this table into the README and the last slide.

| Name | Used for | Link |
| --- | --- | --- |
| Meta Live Video API | Reading live comments | [developers.facebook.com](https://developers.facebook.com/documentation/live-video-api/interact-with-viewers) |
| FastAPI | Backend framework | [fastapi.tiangolo.com](https://fastapi.tiangolo.com/) |
| Uvicorn | Server that runs FastAPI | [uvicorn.org](https://www.uvicorn.org/) |
| httpx | Meta stream and OpenRouter calls | [python-httpx.org](https://www.python-httpx.org/) |
| RapidFuzz | Fuzzy catalog and reference matching | [github.com/rapidfuzz/RapidFuzz](https://github.com/rapidfuzz/RapidFuzz) |
| Pydantic | Validating LLM output and settings | [docs.pydantic.dev](https://docs.pydantic.dev/) |
| psycopg 3 | Postgres driver and pool | [psycopg.org](https://www.psycopg.org/) |
| Supabase | Hosted Postgres | [supabase.com/docs](https://supabase.com/docs) |
| OpenRouter | LLM API | [openrouter.ai/docs](https://openrouter.ai/docs) |
| PayMongo (optional) | QR Ph payments and webhooks, test mode | [QR Ph](https://docs.paymongo.com/docs/payment-acceptance-qr-ph), [testing](https://docs.paymongo.com/docs/payment-acceptance-testing) |
| React | Frontend | [react.dev](https://react.dev/) |
| Vite | Frontend build | [vite.dev](https://vite.dev/) |
| Tailwind CSS | Styling | [tailwindcss.com](https://tailwindcss.com/) |
| React Router | Frontend routes | [reactrouter.com](https://reactrouter.com/) |
| pytest | Unit tests | [pytest.org](https://docs.pytest.org/) |
| Render, Vercel | Hosting | [render.com/docs](https://render.com/docs), [vercel.com/docs](https://vercel.com/docs) |

Also state in the README that AI tools helped write parts of the code and docs, and that every team member can explain the code, as the rules require.
