"""Public routes: the viewer page (watch + comment), the mock QR Ph gateway, the mock
e-wallet, and the gateway webhook. None of these return other buyers' data."""
import re
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import db, rtc, views
from app.hub import hub, sse_events
from app.payments import gateway, wallet
from app.schema import buyers, comments, orders, payment_intents
from app.sources import runner

router = APIRouter(tags=["public"])
_last_comment: dict[str, float] = {}


async def _session(sid: str) -> dict:
    s = await db.get_session(sid)
    if not s:
        raise HTTPException(404, "live not found")
    return s


@router.get("/public/sessions/{sid}")
async def viewer_info(sid: str):
    s = await _session(sid)
    seller = await db.get_seller(s["seller_id"])
    item = await db.get_item(s["current_item_id"]) if s["current_item_id"] else None
    recent = await db.fetch(select(comments.c.id, comments.c.message, comments.c.created_time,
                                   comments.c.parse_stage, comments.c.outcome, buyers.c.display_name)
                            .join(buyers, buyers.c.id == comments.c.buyer_id, isouter=True)
                            .where(comments.c.session_id == sid)
                            .order_by(comments.c.created_time.desc()).limit(40))
    return {
        "id": s["id"], "title": s["title"], "status": s["status"], "shop_name": seller["shop_name"],
        "fb_video_url": s["fb_video_url"], "camera_live": rtc.rtc_state(sid)["live"],
        "on_camera": views.item_view(item) if item else None,
        "comments": [{"id": r["id"], "name": db.mask_name(r["display_name"]), "message": r["message"],
                      "created_time": r["created_time"], "stage": r["parse_stage"], "outcome": r["outcome"]}
                     for r in reversed(recent)],
    }


@router.get("/public/sessions/{sid}/stream")
async def viewer_stream(sid: str, request: Request):
    await _session(sid)
    return StreamingResponse(sse_events(request, f"viewer:{sid}", {"type": "hello"}),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class ChatIn(BaseModel):
    device_id: str = Field(..., min_length=8, max_length=64)
    name: str = Field(..., min_length=1, max_length=40)
    message: str = Field(..., min_length=1, max_length=300)


@router.post("/public/sessions/{sid}/comments")
async def post_comment(sid: str, body: ChatIn):
    """In-app live chat. Feeds the same pipeline as Facebook comments."""
    s = await _session(sid)
    if s["status"] != "running":
        raise HTTPException(409, "this live has ended")
    now = time.time()
    if now - _last_comment.get(body.device_id, 0) < 1.0:
        raise HTTPException(429, "slow down a little")
    _last_comment[body.device_id] = now
    name = re.sub(r"\s+", " ", body.name).strip()
    cid = "chat:" + db.new_id()
    await runner.ingest(sid, {"id": cid, "user_id": "chat:" + body.device_id, "name": name,
                              "message": body.message.strip(), "created_time": db.now(), "source": "chat"})
    return {"ok": True, "id": cid}


@router.get("/public/sessions/{sid}/my-orders")
async def my_orders(sid: str, device_id: str):
    """Order links for this viewer's own claims (so the person who commented can open them)."""
    s = await _session(sid)
    b = await db.fetchone(select(buyers).where(buyers.c.seller_id == s["seller_id"],
                                               buyers.c.platform_user_id == "chat:" + device_id))
    if not b:
        return []
    rows = await views.orders_with([orders.c.session_id == sid, orders.c.buyer_id == b["id"]])
    return [{"token": o["buyer_token"], "item_code": o["item_code"], "item_name": o["item_name"],
             "status": o["status"], "total_centavos": o["total_centavos"]} for o in rows]


# ---- WebRTC: the viewer side ---------------------------------------------------------

class OfferIn(BaseModel):
    peer_id: str = Field(..., min_length=8, max_length=64)
    sdp: str = Field(..., max_length=100_000)


@router.post("/public/sessions/{sid}/rtc/offer")
async def rtc_offer(sid: str, body: OfferIn):
    await _session(sid)
    if not rtc.rtc_state(sid)["live"]:
        raise HTTPException(409, "the seller's camera is off")
    await hub.publish(f"session:{sid}", {"type": "rtc-offer", "peer_id": body.peer_id, "sdp": body.sdp})
    return {"ok": True}


@router.get("/public/rtc/{peer_id}/answer")
async def rtc_answer(peer_id: str):
    sdp = rtc.take_answer(peer_id)
    return {"sdp": sdp}


# ---- mock QR Ph gateway ----------------------------------------------------------------

@router.get("/gateway/intents/{intent_id}")
async def intent_info(intent_id: str):
    it = await db.fetchone(select(payment_intents).where(payment_intents.c.id == intent_id))
    if not it:
        raise HTTPException(404, "payment not found")
    seller = await db.get_seller(it["seller_id"])
    o = await db.get_order(it["order_id"])
    item = await db.get_item(o["item_id"])
    status = it["status"]
    if status == "awaiting_payment" and it["expires_at"] <= db.now():
        status = "expired"
    return {"id": it["id"], "status": status, "amount_centavos": it["amount_centavos"],
            "merchant": seller["shop_name"], "description": f"{item['code']} {item['name']} x{o['qty']}",
            "expires_at": it["expires_at"], "reference": it["reference"], "paid_at": it["paid_at"],
            "order_token": o["buyer_token"], "server_now": db.now()}


class PayIn(BaseModel):
    payer_name: str | None = Field(None, max_length=60)


@router.post("/gateway/intents/{intent_id}/pay")
async def pay(intent_id: str, body: PayIn):
    try:
        it = await gateway.pay_intent(intent_id, body.payer_name)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"status": it["status"], "reference": it["reference"], "paid_at": it["paid_at"]}


@router.post("/gateway/intents/{intent_id}/cancel")
async def cancel_intent(intent_id: str):
    await gateway.cancel_intent(intent_id)
    return {"ok": True}


@router.post("/webhooks/qrph")
async def qrph_webhook(request: Request):
    """Where a real gateway (PayMongo) would deliver signed payment.paid events."""
    raw = await request.body()
    try:
        return await gateway.handle_webhook(raw, request.headers.get(gateway.SIG_HEADER, ""))
    except PermissionError:
        raise HTTPException(401, "bad signature")
    except (KeyError, ValueError):
        raise HTTPException(400, "bad payload")


# ---- mock e-wallet (seller's static QR, Manual mode) -----------------------------------

@router.get("/wallet/{seller_id}")
async def wallet_info(seller_id: str):
    seller = await db.get_seller(seller_id)
    if not seller or seller["id"] != seller_id:
        raise HTTPException(404, "account not found")
    return {"provider": seller["wallet_provider"], "name": seller["wallet_name"],
            "number": seller["wallet_number"], "shop_name": seller["shop_name"]}


class SendIn(BaseModel):
    amount_centavos: int = Field(..., gt=0)
    sender_name: str = Field(..., min_length=1, max_length=60)
    message: str | None = Field(None, max_length=120)


@router.post("/wallet/{seller_id}/send")
async def wallet_send(seller_id: str, body: SendIn):
    seller = await db.get_seller(seller_id)
    if not seller or seller["id"] != seller_id:
        raise HTTPException(404, "account not found")
    try:
        row = await wallet.send_money(seller_id, body.amount_centavos, body.sender_name, body.message)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"reference": row["reference"], "amount_centavos": row["amount_centavos"],
            "paid_at": row["paid_at"], "to_name": seller["wallet_name"], "to_number": seller["wallet_number"]}
