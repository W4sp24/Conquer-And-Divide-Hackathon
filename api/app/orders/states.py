"""Order state machine. The only place an order's status changes.

Every move is one guarded update: it only succeeds if the order is still in a state that
is allowed to move to `to`. If two things race (buyer confirms while the expiry loop
expires), exactly one wins and the other gets None back.
"""
from sqlalchemy import insert, select, update

from app import db
from app.hub import hub
from app.schema import order_events, orders

ALLOWED = {
    "CLAIMED":    {"CONFIRMED", "WAITLISTED", "EXPIRED", "CANCELLED"},
    "WAITLISTED": {"CLAIMED", "EXPIRED", "CANCELLED"},
    "CONFIRMED":  {"PROOF_SENT", "EXPIRED", "CANCELLED"},
    "PROOF_SENT": {"VERIFIED", "CONFIRMED", "CANCELLED"},  # back to CONFIRMED = proof rejected
    "VERIFIED":   {"PACKED"},
    "PACKED":     {"SHIPPED", "VERIFIED"},                 # VERIFIED again = seller un-ticked Packed
    "SHIPPED":    {"PACKED"},                              # seller un-ticked Shipped
}
ACTIVE = ("CLAIMED", "WAITLISTED")                          # waiting for a unit
LOCKED = ("CONFIRMED", "PROOF_SENT", "VERIFIED", "PACKED", "SHIPPED")  # keeps its unit
OPEN = ("CLAIMED", "WAITLISTED", "CONFIRMED", "PROOF_SENT")
ENDED = ("EXPIRED", "CANCELLED")


def sources_of(to: str) -> list[str]:
    return [s for s, nxt in ALLOWED.items() if to in nxt]


async def transition(order_id: str, to: str, actor: str, note: str | None = None, **fields) -> dict | None:
    """Move one order. Returns the updated row (with from_status), or None if not allowed now."""
    froms = sources_of(to)
    async with db.tx() as c:
        old = await db.c_fetchone(c, select(orders.c.status).where(orders.c.id == order_id))
        if not old or old["status"] not in froms:
            return None
        res = await c.execute(update(orders)
                              .where(orders.c.id == order_id, orders.c.status == old["status"])
                              .values(status=to, updated_at=db.now(), **fields))
        if res.rowcount != 1:
            return None
        await c.execute(insert(order_events).values(order_id=order_id, from_status=old["status"],
                                                    to_status=to, actor=actor, note=note))
        row = await db.c_fetchone(c, select(orders).where(orders.c.id == order_id))
    row["from_status"] = old["status"]
    await publish_order(row)
    return row


async def publish_order(row: dict, extra: dict | None = None):
    ev = {"type": "order", "order_id": row["id"], "status": row["status"],
          "item_id": row["item_id"], **(extra or {})}
    await hub.publish(f"session:{row['session_id']}", ev)
    await hub.publish(f"seller:{row['seller_id']}", ev)
    await hub.publish(f"order:{row['buyer_token']}", ev)
    await hub.publish(f"viewer:{row['session_id']}", {"type": "order", "item_id": row["item_id"]})
