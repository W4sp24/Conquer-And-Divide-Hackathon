"""Read models: what each screen gets. Kept apart from the write logic so every screen's
data is in one place."""
from sqlalchemy import func, select

from app import db
from app.hub import hub
from app.orders.labels import label
from app.orders.queue import line_position
from app.orders.states import ENDED, LOCKED
from app.pipeline.llm import LAST_STATUS, llm_enabled
from app.config import settings
from app.schema import buyers, catalog_items, comments, order_events, orders, payment_intents

STATUS_ORDER = ["WAITLISTED", "CLAIMED", "CONFIRMED", "PROOF_SENT", "VERIFIED", "PACKED", "SHIPPED"]


def item_view(i: dict) -> dict:
    return {"id": i["id"], "code": i["code"], "name": i["name"], "price_centavos": i["price_centavos"],
            "sizes": i["sizes"] or [], "stock": i["stock"], "keywords": i["keywords"] or [],
            "photo_url": i["photo_url"], "tone": i["tone"], "active": i["active"]}


def order_view(o: dict, item: dict | None, buyer: dict | None, masked: bool = True) -> dict:
    name = (buyer or {}).get("display_name", "Viewer")
    return {
        "id": o["id"], "status": o["status"], "session_id": o["session_id"],
        "item_id": o["item_id"], "item_code": (item or {}).get("code"), "item_name": (item or {}).get("name"),
        "item_tone": (item or {}).get("tone"), "item_photo": (item or {}).get("photo_url"),
        "buyer_id": o["buyer_id"], "buyer": db.mask_name(name) if masked else name,
        "buyer_label": label(buyer) if buyer else "NEW",
        "size": o["size"], "qty": o["qty"], "unit_price_centavos": o["unit_price_centavos"],
        "total_centavos": o["total_centavos"], "for_name": o["for_name"],
        "claimed_at": o["claimed_at"], "hold_until": o["hold_until"], "pay_by": o["pay_by"],
        "proof_reference": o["proof_reference"], "proof_submitted_at": o["proof_submitted_at"],
        "proof_channel": o["proof_channel"], "proof_attested": o["proof_attested"],
        "verdict": o["verdict"], "verdict_reasons": o["verdict_reasons"] or [],
        "verdict_suggestion": o["verdict_suggestion"], "seller_note": o["seller_note"],
        "buyer_token": o["buyer_token"], "updated_at": o["updated_at"],
    }


async def orders_with(where, masked=False, order_by=None) -> list[dict]:
    rows = await db.fetch(select(orders).where(*where).order_by(*(order_by or [orders.c.claimed_at])))
    if not rows:
        return []
    item_ids = {r["item_id"] for r in rows}
    buyer_ids = {r["buyer_id"] for r in rows}
    items = {i["id"]: i for i in await db.fetch(select(catalog_items).where(catalog_items.c.id.in_(item_ids)))}
    bs = {b["id"]: b for b in await db.fetch(select(buyers).where(buyers.c.id.in_(buyer_ids)))}
    return [order_view(r, items.get(r["item_id"]), bs.get(r["buyer_id"]), masked) for r in rows]


def comment_view(c: dict, name: str) -> dict:
    return {"id": c["id"], "name": db.mask_name(name), "message": c["message"], "source": c["source"],
            "created_time": c["created_time"], "stage": c["parse_stage"], "result": c["parse_result"],
            "confidence": c["confidence"], "outcome": c["outcome"], "resolved": c["resolved"]}


async def comment_rows(session_id: str, limit: int = 150, review_only: bool = False) -> list[dict]:
    q = (select(comments, buyers.c.display_name)
         .join(buyers, buyers.c.id == comments.c.buyer_id, isouter=True)
         .where(comments.c.session_id == session_id))
    if review_only:
        q = q.where(comments.c.parse_stage == "review", comments.c.resolved.is_(False))
        q = q.order_by(comments.c.created_time)
    else:
        q = q.order_by(comments.c.created_time.desc()).limit(limit)
    rows = await db.fetch(q)
    out = [comment_view(r, r.get("display_name") or "Viewer") for r in rows]
    return out if review_only else list(reversed(out))


async def scoreboard(session_id: str) -> dict:
    rows = await db.fetch(select(comments.c.parse_stage, func.count().label("n"))
                          .where(comments.c.session_id == session_id).group_by(comments.c.parse_stage))
    by = {r["parse_stage"] or "pending": r["n"] for r in rows}
    return {"rules": by.get("rules", 0), "fuzzy": by.get("fuzzy", 0), "llm": by.get("llm", 0),
            "review": by.get("review", 0), "fixed": by.get("fixed", 0), "ignored": by.get("ignored", 0),
            "total": sum(by.values())}


def llm_info() -> dict:
    return {"enabled": llm_enabled(), "model": settings.openrouter_model if llm_enabled() else None,
            "last_ok": LAST_STATUS.get("ok"), "last_error": LAST_STATUS.get("error"),
            "latency_ms": LAST_STATUS.get("latency_ms")}


async def board(session_id: str) -> dict:
    from app.sources.runner import RUNNING
    from app.rtc import rtc_state

    s = await db.get_session(session_id)
    catalog = await db.get_catalog(s["seller_id"])
    session_orders = await orders_with([orders.c.session_id == session_id], masked=True)
    by_item: dict[str, list] = {}
    for o in session_orders:
        by_item.setdefault(o["item_id"], []).append(o)
    items = []
    for i in catalog:
        os_ = by_item.get(i["id"], [])
        locked_units = sum(o["qty"] for o in os_ if o["status"] in LOCKED)
        items.append({**item_view(i),
                      "claimed": [o for o in os_ if o["status"] == "CLAIMED"],
                      "confirmed": [o for o in os_ if o["status"] in LOCKED],
                      "waitlist": [o for o in os_ if o["status"] == "WAITLISTED"],
                      "ended": [o for o in os_ if o["status"] in ENDED],
                      "free_units": max(i["stock"] - locked_units -
                                        sum(o["qty"] for o in os_ if o["status"] == "CLAIMED"), 0)})
    on_cam = next((x for x in items if x["id"] == s["current_item_id"]), None)
    recent = [x for rid in reversed(s["recent_item_ids"] or []) for x in items if x["id"] == rid]
    seller = await db.get_seller(s["seller_id"])
    return {
        "session": session_view(s, running_task=s["id"] in RUNNING),
        "shop_name": seller["shop_name"], "seller_name": seller["name"],
        "on_camera": on_cam, "recent": recent[:6], "items": items,
        "review": await comment_rows(session_id, review_only=True),
        "comments": await comment_rows(session_id),
        "score": await scoreboard(session_id),
        "totals": {
            "orders": len([o for o in session_orders if o["status"] not in ENDED]),
            "value_centavos": sum(o["total_centavos"] for o in session_orders if o["status"] not in ENDED),
            "waitlisted": len([o for o in session_orders if o["status"] == "WAITLISTED"]),
        },
        "llm": llm_info(),
        "viewers": hub.count(f"viewer:{session_id}"),
        "camera_live": rtc_state(session_id)["live"],
    }


def session_view(s: dict, running_task: bool = False) -> dict:
    return {"id": s["id"], "title": s["title"], "source": s["source"], "live_video_id": s["live_video_id"],
            "fb_video_url": s["fb_video_url"], "replay_speed": s["replay_speed"], "status": s["status"],
            "error": s["error"], "created_at": s["created_at"], "started_at": s["started_at"],
            "ended_at": s["ended_at"], "current_item_id": s["current_item_id"], "reader_running": running_task}


async def buyer_view(o: dict) -> dict:
    """What the buyer's private page shows: their own order only, never other buyers."""
    item = await db.get_item(o["item_id"])
    seller = await db.get_seller(o["seller_id"])
    s = await db.get_session(o["session_id"])
    buyer = await db.get_buyer(o["buyer_id"])
    intent = await db.fetchone(select(payment_intents).where(payment_intents.c.order_id == o["id"])
                               .order_by(payment_intents.c.created_at.desc()).limit(1))
    pos = await line_position(o) if o["status"] == "WAITLISTED" else None
    last_event = await db.fetchone(select(order_events).where(order_events.c.order_id == o["id"])
                                   .order_by(order_events.c.id.desc()).limit(1))
    return {
        "status": o["status"], "shop_name": seller["shop_name"], "seller_name": seller["name"],
        "session_title": s["title"], "buyer_name": buyer["display_name"],
        "item": {"code": item["code"], "name": item["name"], "price_centavos": item["price_centavos"],
                 "sizes": item["sizes"] or [], "photo_url": item["photo_url"], "tone": item["tone"]},
        "size": o["size"], "qty": o["qty"], "total_centavos": o["total_centavos"],
        "unit_price_centavos": o["unit_price_centavos"], "for_name": o["for_name"],
        "claimed_at": o["claimed_at"], "hold_until": o["hold_until"], "pay_by": o["pay_by"],
        "line_position": pos,
        "payment": {"mode": seller["payment_mode"], "provider": seller["wallet_provider"],
                    "name": seller["wallet_name"], "number": seller["wallet_number"],
                    "seller_id": seller["id"]},
        "proof_reference": o["proof_reference"], "proof_submitted_at": o["proof_submitted_at"],
        "proof_channel": o["proof_channel"],
        # Hold reasons stay on the seller's screen: the buyer is never accused by the system.
        "checking": o["status"] == "PROOF_SENT",
        "seller_note": o["seller_note"],
        "qr": ({"intent_id": intent["id"], "status": intent["status"], "expires_at": intent["expires_at"],
                "amount_centavos": intent["amount_centavos"]} if intent else None),
        "last_note": (last_event or {}).get("note"),
        "server_now": db.now(),
    }
