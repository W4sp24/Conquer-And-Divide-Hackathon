"""Mock QR Ph gateway ("MockPay"): a stand-in for PayMongo's QR Ph in test mode.

Real world:   our backend asks the gateway for a QR Ph code for the exact order amount ->
              buyer scans it with any bank/e-wallet app -> gateway calls our webhook
              `payment.paid` (signed) -> order verified with no statement upload.
This mock:    same three steps. The QR encodes our own /pay/{intent_id} page, whose
              "Confirm payment" button plays the buyer's bank app. Confirming makes the
              mock gateway sign a `payment.paid` event with HMAC-SHA256 and deliver it to
              the same webhook handler a real gateway would call (POST /webhooks/qrph).
Swapping in PayMongo means replacing create_intent() and the payload paths only.
"""
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from app import db
from app.config import settings
from app.hub import hub
from app.orders.states import publish_order
from app.schema import payment_intents, payments, sellers

SIG_HEADER = "X-MockPay-Signature"


# ---- gateway side (what PayMongo would run) -----------------------------------------

async def create_intent(order: dict) -> dict:
    """Reuse a live intent for this order, or create a new one."""
    now = db.now()
    live = await db.fetchone(select(payment_intents).where(
        payment_intents.c.order_id == order["id"], payment_intents.c.status == "awaiting_payment",
        payment_intents.c.expires_at > now).order_by(payment_intents.c.created_at.desc()))
    if live and live["amount_centavos"] == order["total_centavos"]:
        return live
    iid = "pi_" + secrets.token_hex(10)
    await db.execute(insert(payment_intents).values(
        id=iid, seller_id=order["seller_id"], order_id=order["id"],
        amount_centavos=order["total_centavos"], status="awaiting_payment",
        expires_at=now + timedelta(minutes=settings.qr_minutes)))
    return await db.fetchone(select(payment_intents).where(payment_intents.c.id == iid))


def sign(raw: bytes, ts: int | None = None) -> str:
    ts = ts or int(time.time())
    mac = hmac.new(settings.gateway_webhook_secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256)
    return f"t={ts},te={mac.hexdigest()}"


async def pay_intent(intent_id: str, payer_name: str | None) -> dict:
    """The buyer's bank app approved the payment. Marks the intent paid and fires the webhook."""
    it = await db.fetchone(select(payment_intents).where(payment_intents.c.id == intent_id))
    if not it:
        raise LookupError("payment not found")
    if it["status"] == "paid":
        return it                                       # double tap: already paid
    if it["status"] != "awaiting_payment" or it["expires_at"] <= db.now():
        raise ValueError("this QR code has expired. Go back to the order page for a new one")
    o = await db.get_order(it["order_id"])
    if not o or o["status"] != "CONFIRMED":
        raise ValueError("this order can no longer be paid")
    ref = "QRPH" + "".join(secrets.choice("0123456789") for _ in range(10))
    paid_at = db.now()
    res = await db.execute(update(payment_intents).where(
        payment_intents.c.id == intent_id, payment_intents.c.status == "awaiting_payment").values(
        status="paid", reference=ref, payer_name=(payer_name or "")[:60] or None, paid_at=paid_at))
    if res != 1:
        return await db.fetchone(select(payment_intents).where(payment_intents.c.id == intent_id))
    event = {"data": {"id": "evt_" + secrets.token_hex(8), "attributes": {
        "type": "payment.paid",
        "data": {"id": ref, "attributes": {
            "amount": it["amount_centavos"], "currency": "PHP", "source": {"type": "qrph"},
            "paid_at": int(paid_at.timestamp()),
            "metadata": {"order_id": it["order_id"], "intent_id": intent_id}}}}}}
    raw = json.dumps(event).encode()
    await handle_webhook(raw, sign(raw))               # same path an HTTP delivery takes
    return await db.fetchone(select(payment_intents).where(payment_intents.c.id == intent_id))


async def cancel_intent(intent_id: str) -> None:
    await db.execute(update(payment_intents).where(
        payment_intents.c.id == intent_id, payment_intents.c.status == "awaiting_payment")
        .values(status="cancelled"))


async def expire_intents() -> int:
    return await db.execute(update(payment_intents).where(
        payment_intents.c.status == "awaiting_payment", payment_intents.c.expires_at <= db.now())
        .values(status="expired"))


# ---- our side (the webhook a real gateway calls) --------------------------------------

def valid_signature(header: str, raw: bytes, tolerance_s: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        ts = int(parts.get("t", "0"))
    except ValueError:
        return False
    if abs(time.time() - ts) > tolerance_s:
        return False                                    # replayed old event
    mac = hmac.new(settings.gateway_webhook_secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256)
    return hmac.compare_digest(mac.hexdigest(), parts.get("te", ""))


async def handle_webhook(raw: bytes, signature: str) -> dict:
    from app.payments.service import run_check, seller_release, submit_proof

    if not valid_signature(signature, raw):
        raise PermissionError("bad signature")
    event = json.loads(raw)["data"]["attributes"]
    if event["type"] != "payment.paid":
        return {"ok": True, "ignored": event["type"]}
    pay = event["data"]
    attrs = pay["attributes"]
    order_id = attrs["metadata"]["order_id"]
    o = await db.get_order(order_id)
    if not o:
        return {"ok": False, "error": "unknown order"}
    paid_at = datetime.fromtimestamp(attrs.get("paid_at") or time.time(), tz=timezone.utc)
    try:
        await db.execute(insert(payments).values(
            id=db.new_id(), seller_id=o["seller_id"], source="qrph", reference=pay["id"],
            amount_centavos=attrs["amount"], paid_at=paid_at, order_id=order_id))
    except IntegrityError:
        return {"ok": True, "duplicate": True}          # retries are safe: payments are unique
    if o["status"] == "CONFIRMED":
        await submit_proof(o, pay["id"], attrs["amount"], True, channel="qrph", actor="webhook")
    else:
        await run_check(order_id)
    o = await db.get_order(order_id)
    seller = await db.fetchone(select(sellers).where(sellers.c.id == o["seller_id"]))
    if o["status"] == "PROOF_SENT" and o["verdict"] == "RELEASE" and seller["auto_release_gateway"]:
        await seller_release(order_id, actor="system", note="auto-released: QR Ph payment confirmed by gateway")
    o = await db.get_order(order_id)
    await hub.publish(f"seller:{o['seller_id']}", {"type": "payment", "order_id": order_id,
                                                   "source": "qrph", "amount": attrs["amount"]})
    await publish_order(o)
    return {"ok": True}

