"""Claim queue, waitlist, buyer confirm and the expiry loop.

Queue rule (who gets the item): an item has `stock` units. Orders that are CONFIRMED or
later keep their units. The remaining units go to CLAIMED/WAITLISTED orders sorted by
comment time (the platform's timestamp, not our processing time), earliest first.
`rebalance` re-runs the rule whenever a claim arrives, is cancelled or expires, so a
comment that waited longer for the LLM still gets its fair place ("ako nauna!").
"""
import asyncio
import logging
import secrets
from datetime import timedelta

from sqlalchemy import func, insert, select, update

from app import db
from app.config import settings
from app.orders.states import ACTIVE, LOCKED, OPEN, transition
from app.schema import buyers, catalog_items, orders

log = logging.getLogger("queue")
_queue_lock = asyncio.Lock()        # one rebalance at a time inside this process


async def bump_buyer(buyer_id: str, **counts):
    """bump_buyer(id, claims=1) / (verified=1, paid_centavos=85000)."""
    paid = counts.pop("paid_centavos", None)
    async with db.tx() as c:
        b = await db.c_fetchone(c, select(buyers).where(buyers.c.id == buyer_id))
        if not b:
            return
        vals = {k: (b[k] or 0) + v for k, v in counts.items()}
        if paid is not None:
            vals["max_paid_centavos"] = max(b["max_paid_centavos"] or 0, paid)
        await c.execute(update(buyers).where(buyers.c.id == buyer_id).values(**vals))


async def hold_minutes(seller_id: str) -> int:
    s = await db.get_seller(seller_id)
    return (s or {}).get("hold_minutes") or settings.hold_minutes


async def line_position(order: dict) -> int:
    """1-based place among the WAITLISTED orders of the same item."""
    n = await db.fetchval(select(func.count()).select_from(orders).where(
        orders.c.item_id == order["item_id"], orders.c.status == "WAITLISTED",
        orders.c.claimed_at < order["claimed_at"]))
    return int(n or 0) + 1


async def apply_intent(s: dict, buyer: dict, c: dict, r: dict) -> str | None:
    """Turn a parse into an order change. Returns a short outcome for the feed."""
    intent, code = r.get("intent"), r.get("item_code")
    if intent in ("claim", "waitlist") and code:
        item = await db.item_by_code(s["seller_id"], code)
        if not item or not item["active"]:
            return None
        dup = await db.fetchone(select(orders.c.id, orders.c.status).where(
            orders.c.buyer_id == buyer["id"], orders.c.item_id == item["id"],
            orders.c.session_id == s["id"], orders.c.status.in_(OPEN)))
        if dup:
            return f"already in line for {item['code']}"
        qty = max(1, min(int(r.get("qty") or 1), max(item["stock"], 1)))
        oid = db.new_id()
        await db.execute(insert(orders).values(
            id=oid, seller_id=s["seller_id"], session_id=s["id"], buyer_id=buyer["id"],
            item_id=item["id"], comment_id=c.get("id"), size=r.get("size"), qty=qty,
            unit_price_centavos=item["price_centavos"], total_centavos=item["price_centavos"] * qty,
            for_name=r.get("for_name"), status="WAITLISTED", claimed_at=c["created_time"],
            buyer_token=secrets.token_urlsafe(16)))
        await bump_buyer(buyer["id"], claims=1)
        await rebalance(item["id"])
        o = await db.get_order(oid)
        if o["status"] == "CLAIMED":
            return f"claimed {item['code']}"
        if o["status"] == "WAITLISTED":
            # a fresh WAITLISTED row is published here since rebalance did not move it
            from app.orders.states import publish_order
            await publish_order(o)
            return f"waitlisted {item['code']} (#{await line_position(o)})"
        return None
    if intent == "cancel":
        q = select(orders).where(orders.c.buyer_id == buyer["id"], orders.c.session_id == s["id"],
                                 orders.c.status.in_(("CLAIMED", "WAITLISTED", "CONFIRMED")))
        if code:
            item = await db.item_by_code(s["seller_id"], code)
            if not item:
                return None
            q = q.where(orders.c.item_id == item["id"])
        o = await db.fetchone(q.order_by(orders.c.claimed_at.desc()).limit(1))
        if o and await transition(o["id"], "CANCELLED", "buyer", "cancelled in comments"):
            await bump_buyer(buyer["id"], cancels=1)
            await rebalance(o["item_id"])
            item = await db.get_item(o["item_id"])
            return f"cancelled {item['code']}"
    return None


async def rebalance(item_id: str):
    async with _queue_lock:
        item = await db.fetchone(select(catalog_items).where(catalog_items.c.id == item_id))
        if not item:
            return
        locked = await db.fetchval(select(func.coalesce(func.sum(orders.c.qty), 0)).where(
            orders.c.item_id == item_id, orders.c.status.in_(LOCKED)))
        free = max(item["stock"] - int(locked or 0), 0)
        waiting = await db.fetch(select(orders.c.id, orders.c.status, orders.c.qty, orders.c.seller_id)
                                 .where(orders.c.item_id == item_id, orders.c.status.in_(ACTIVE))
                                 .order_by(orders.c.claimed_at, orders.c.created_at))
        hold = timedelta(minutes=await hold_minutes(item["seller_id"]))
        blocked = False                         # strict first come, first served
        for o in waiting:
            fits = not blocked and o["qty"] <= free
            if fits:
                free -= o["qty"]
            else:
                blocked = True
            want = "CLAIMED" if fits else "WAITLISTED"
            if o["status"] != want:
                extra = {"hold_until": db.now() + hold} if want == "CLAIMED" else {"hold_until": None}
                note = "promoted from waitlist" if want == "CLAIMED" else "moved to waitlist"
                await transition(o["id"], want, "system", note, **extra)


async def confirm(order: dict, size: str | None, qty: int | None) -> dict | None:
    """Buyer taps Confirm on the private link, optionally fixing size or qty."""
    seller = await db.get_seller(order["seller_id"])
    fields = {"pay_by": db.now() + timedelta(hours=(seller or {}).get("pay_window_hours")
                                              or settings.pay_window_hours)}
    item = await db.get_item(order["item_id"])
    if size:
        if item["sizes"] and size not in item["sizes"]:
            raise ValueError(f"size must be one of {', '.join(item['sizes'])}")
        fields["size"] = size
    elif item["sizes"] and not order.get("size"):
        raise ValueError("pick a size first")
    if qty and qty != order["qty"]:
        locked = await db.fetchval(select(func.coalesce(func.sum(orders.c.qty), 0)).where(
            orders.c.item_id == order["item_id"], orders.c.status.in_(LOCKED)))
        available = item["stock"] - int(locked or 0)
        if qty < 1 or qty > max(available, order["qty"]):
            raise ValueError(f"only {max(available, order['qty'])} available")
        fields["qty"], fields["total_centavos"] = qty, order["unit_price_centavos"] * qty
    row = await transition(order["id"], "CONFIRMED", "buyer", "confirmed on link", **fields)
    if row:
        await rebalance(order["item_id"])      # a smaller qty may free a unit for the next buyer
    return row


async def cancel_by_buyer(order: dict) -> dict | None:
    row = await transition(order["id"], "CANCELLED", "buyer", "cancelled on link")
    if row:
        await bump_buyer(order["buyer_id"], cancels=1)
        await rebalance(order["item_id"])
    return row


async def expire_due() -> int:
    """Expire late claims and unpaid orders. Returns how many moved."""
    now = db.now()
    rows = await db.fetch(select(orders.c.id, orders.c.item_id, orders.c.buyer_id, orders.c.status)
                          .where(((orders.c.status == "CLAIMED") & (orders.c.hold_until < now)) |
                                 ((orders.c.status == "CONFIRMED") & (orders.c.pay_by < now))))
    n = 0
    for o in rows:
        note = "not confirmed in time" if o["status"] == "CLAIMED" else "not paid in time"
        if await transition(o["id"], "EXPIRED", "system", note):
            n += 1
            if o["status"] == "CONFIRMED":
                await bump_buyer(o["buyer_id"], expired_unpaid=1)
            await rebalance(o["item_id"])
    return n


async def expiry_loop():
    """Started on app startup."""
    while True:
        try:
            await expire_due()
            from app.payments.gateway import expire_intents
            await expire_intents()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("expiry loop error")
        await asyncio.sleep(settings.expiry_interval_s)
