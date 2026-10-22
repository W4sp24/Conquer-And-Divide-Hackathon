"""Seller settings, buyer records (with delete-my-data), insights, and network info."""
import socket
from collections import Counter, defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update

from app import db, views
from app.auth import seller_only
from app.config import settings
from app.orders.labels import LABEL_NOTES, label
from app.orders.states import ENDED
from app.schema import (buyers, comments, live_sessions, order_events, orders, payment_intents, payments,
                        proofs, sellers)

router = APIRouter(tags=["seller"])


def _seller_view(s: dict) -> dict:
    return {k: s[k] for k in ("id", "name", "shop_name", "payment_mode", "wallet_provider", "wallet_name",
                              "wallet_number", "auto_release_gateway", "hold_minutes", "pay_window_hours")}


@router.get("/seller")
async def get_seller(seller=Depends(seller_only)):
    return {**_seller_view(seller), "llm": views.llm_info(),
            "meta_configured": bool(settings.meta_page_token)}


class SellerIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    shop_name: str = Field(..., min_length=1, max_length=80)
    payment_mode: str = Field(..., pattern="^(manual|instant_qr|both)$")
    wallet_provider: str = Field("GCash", max_length=30)
    wallet_name: str = Field("", max_length=60)
    wallet_number: str = Field("", max_length=30)
    auto_release_gateway: bool = True
    hold_minutes: int = Field(15, ge=1, le=240)
    pay_window_hours: int = Field(24, ge=1, le=168)


@router.put("/seller")
async def put_seller(body: SellerIn, seller=Depends(seller_only)):
    await db.execute(update(sellers).where(sellers.c.id == seller["id"]).values(**body.model_dump()))
    return _seller_view(await db.get_seller(seller["id"]))


@router.get("/net")
async def net_info():
    """LAN address, so phones on the same Wi-Fi can open the viewer QR."""
    ip = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except OSError:
        pass
    return {"lan_ip": ip, "public_web_url": settings.public_web_url or None}


@router.get("/buyers")
async def list_buyers(seller=Depends(seller_only)):
    rows = await db.fetch(select(buyers).where(buyers.c.seller_id == seller["id"]))
    open_counts = Counter(r["buyer_id"] for r in await db.fetch(
        select(orders.c.buyer_id).where(orders.c.seller_id == seller["id"],
                                        orders.c.status.in_(("CLAIMED", "WAITLISTED", "CONFIRMED", "PROOF_SENT")))))
    out = []
    for b in rows:
        lb = label(b)
        out.append({"id": b["id"], "name": b["display_name"], "label": lb, "label_note": LABEL_NOTES[lb],
                    "claims": b["claims"], "verified": b["verified"], "failed_proofs": b["failed_proofs"],
                    "expired_unpaid": b["expired_unpaid"], "cancels": b["cancels"],
                    "max_paid_centavos": b["max_paid_centavos"], "open_orders": open_counts.get(b["id"], 0),
                    "source": b["platform_user_id"].split(":")[0] if ":" in b["platform_user_id"] else "meta"})
    rank = {"HOLD": 0, "WATCH": 1, "NEW": 2, "TRUSTED": 3}
    out.sort(key=lambda x: (rank[x["label"]], -x["claims"], x["name"]))
    return out


@router.delete("/buyers/{buyer_id}")
async def delete_buyer(buyer_id: str, seller=Depends(seller_only)):
    """Data Privacy Act (RA 10173): wipe one buyer's rows on request."""
    b = await db.get_buyer(buyer_id)
    if not b or b["seller_id"] != seller["id"]:
        raise HTTPException(404, "buyer not found")
    rows = await db.fetch(select(orders.c.id, orders.c.item_id).where(orders.c.buyer_id == buyer_id))
    oids = [r["id"] for r in rows]
    async with db.tx() as c:
        if oids:
            await c.execute(delete(order_events).where(order_events.c.order_id.in_(oids)))
            await c.execute(delete(proofs).where(proofs.c.order_id.in_(oids)))
            await c.execute(delete(payment_intents).where(payment_intents.c.order_id.in_(oids)))
            await c.execute(update(payments).where(payments.c.order_id.in_(oids)).values(order_id=None))
            await c.execute(delete(orders).where(orders.c.id.in_(oids)))
        await c.execute(delete(comments).where(comments.c.buyer_id == buyer_id))
        await c.execute(delete(buyers).where(buyers.c.id == buyer_id))
    from app.orders.queue import rebalance
    for item_id in {r["item_id"] for r in rows}:
        await rebalance(item_id)                  # their freed units go to the next in line
    return {"ok": True, "orders_deleted": len(oids)}


@router.get("/insights")
async def insights(session_id: str | None = None, seller=Depends(seller_only)):
    s = await db.get_session(session_id) if session_id else await db.fetchone(
        select(live_sessions).where(live_sessions.c.seller_id == seller["id"])
        .order_by(live_sessions.c.created_at.desc()).limit(1))
    if not s:
        return {"session": None}
    sid = s["id"]
    os_ = await views.orders_with([orders.c.session_id == sid])
    events = await db.fetch(select(order_events.c.order_id, order_events.c.to_status, order_events.c.note)
                            .join(orders, orders.c.id == order_events.c.order_id)
                            .where(orders.c.session_id == sid))
    reached: dict[str, set] = defaultdict(set)
    rejected_ids = set()
    for e in events:
        reached[e["order_id"]].add(e["to_status"])
        if (e["note"] or "").startswith("proof rejected"):
            rejected_ids.add(e["order_id"])
    for o in os_:
        reached[o["id"]].add(o["status"])

    def count(*sts):
        return sum(1 for o in os_ if reached[o["id"]] & set(sts))

    score = await views.scoreboard(sid)
    paid = [o for o in os_ if o["status"] in ("VERIFIED", "PACKED", "SHIPPED")]
    live_orders = [o for o in os_ if o["status"] not in ENDED]
    claimed_n = count("CLAIMED", "WAITLISTED", "CONFIRMED")
    kpis = [
        {"label": "Comments read", "value": score["total"],
         "sub": f"{score['rules'] + score['fuzzy'] + score['llm'] + score['fixed']} were orders or cancels"},
        {"label": "Orders taken", "value": len(live_orders),
         "sub": f"{len([o for o in os_ if o['status'] == 'WAITLISTED'])} on a waitlist"},
        {"label": "Order value", "value_centavos": sum(o["total_centavos"] for o in live_orders),
         "sub": "claimed, not cancelled or expired"},
        {"label": "Paid and verified", "value_centavos": sum(o["total_centavos"] for o in paid),
         "sub": f"{len(paid)} order{'s' if len(paid) != 1 else ''}"},
    ]
    start = s["started_at"] or s["created_at"]
    buckets: dict[int, list] = defaultdict(list)
    for o in live_orders:
        buckets[max(0, int((o["claimed_at"] - start).total_seconds() // 600))].append(o)
    n_buckets = max(buckets.keys(), default=0) + 1
    bars = []
    for b in range(min(n_buckets, 36)):
        group = buckets.get(b, [])
        top = Counter(o["item_code"] for o in group).most_common(1)
        t = start + timedelta(minutes=10 * b)
        bars.append({"start": t, "value_centavos": sum(o["total_centavos"] for o in group),
                     "orders": len(group), "top": top[0][0] if top else None})
    funnel = [
        {"label": "Claimed", "count": claimed_n},
        {"label": "Confirmed by buyer", "count": count("CONFIRMED")},
        {"label": "Payment sent", "count": count("PROOF_SENT")},
        {"label": "Verified", "count": count("VERIFIED")},
        {"label": "Shipped", "count": count("SHIPPED")},
    ]
    proofs_ = [o for o in os_ if o["proof_reference"]]
    checks = {"RELEASE": 0, "HOLD": 0, "PENDING": 0}
    for o in proofs_:
        if o["status"] == "PROOF_SENT" and o["verdict"] in checks:
            checks[o["verdict"]] += 1
    caught = [o for o in os_ if o["id"] in rejected_ids or (o["status"] == "PROOF_SENT" and o["verdict"] == "HOLD")]
    catalog = await db.get_catalog(s["seller_id"])
    items = []
    for i in catalog:
        mine = [o for o in os_ if o["item_id"] == i["id"]]
        if not mine:
            continue
        active = [o for o in mine if o["status"] not in ENDED]
        holding = sum(o["qty"] for o in active if o["status"] != "WAITLISTED")
        items.append({"code": i["code"], "name": i["name"], "claimed": len(mine),
                      "waiting": len([o for o in mine if o["status"] == "WAITLISTED"]),
                      "value_centavos": sum(o["total_centavos"] for o in active if o["status"] != "WAITLISTED"),
                      "status": "Sold out" if holding >= i["stock"] else f"{i['stock'] - holding} left"})
    items.sort(key=lambda x: (-x["claimed"], x["code"]))
    return {"session": views.session_view(s), "kpis": kpis, "bars": bars, "funnel": funnel,
            "score": score, "checks": checks, "verified": len(paid),
            "caught_count": len(caught), "caught_centavos": sum(o["total_centavos"] for o in caught),
            "statement_uploaded": bool(await db.statement_until(s["seller_id"])),
            "items": items, "orders_total": len(os_)}

