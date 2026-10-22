"""Buyer routes. No login: the order's private 128-bit token is the only key, and the page
shows that one order only."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import db, views
from app.hub import sse_events
from app.orders.queue import cancel_by_buyer, confirm
from app.payments import gateway
from app.payments.service import submit_proof
from app.schema import orders

router = APIRouter(prefix="/buyer", tags=["buyer"])


async def _order(token: str) -> dict:
    o = await db.fetchone(select(orders).where(orders.c.buyer_token == token))
    if not o:
        raise HTTPException(404, "order not found")
    return o


@router.get("/{token}")
async def get_order(token: str):
    return await views.buyer_view(await _order(token))


@router.get("/{token}/stream")
async def stream(token: str, request: Request):
    await _order(token)
    return StreamingResponse(sse_events(request, f"order:{token}", {"type": "hello"}),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class ConfirmIn(BaseModel):
    size: str | None = None
    qty: int | None = Field(None, ge=1, le=20)


@router.post("/{token}/confirm")
async def confirm_order(token: str, body: ConfirmIn):
    o = await _order(token)
    if o["status"] != "CLAIMED":
        raise HTTPException(409, "this order can't be confirmed now")
    try:
        row = await confirm(o, body.size, body.qty)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not row:
        raise HTTPException(409, "this order can't be confirmed now")
    return await views.buyer_view(await _order(token))


@router.post("/{token}/cancel")
async def cancel(token: str):
    o = await _order(token)
    if not await cancel_by_buyer(o):
        raise HTTPException(409, "this order can't be cancelled now")
    return await views.buyer_view(await _order(token))


class ProofIn(BaseModel):
    reference: str = Field(..., min_length=4, max_length=64)
    attested: bool
    amount_centavos: int | None = Field(None, gt=0)


@router.post("/{token}/proof")
async def proof(token: str, body: ProofIn):
    o = await _order(token)
    if o["status"] != "CONFIRMED":
        raise HTTPException(409, "this order isn't waiting for payment")
    if not body.attested:
        raise HTTPException(422, "check the payment in your app first")
    try:
        row = await submit_proof(o, body.reference, body.amount_centavos, True)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not row:
        raise HTTPException(409, "this order isn't waiting for payment")
    return await views.buyer_view(await _order(token))


@router.post("/{token}/qr")
async def qr(token: str):
    """Instant QR: get a QR Ph code for the exact order amount (mock gateway)."""
    o = await _order(token)
    seller = await db.get_seller(o["seller_id"])
    if seller["payment_mode"] == "manual":
        raise HTTPException(409, "this seller takes manual payments only")
    if o["status"] != "CONFIRMED":
        raise HTTPException(409, "confirm the order first")
    it = await gateway.create_intent(o)
    return {"intent_id": it["id"], "status": it["status"], "expires_at": it["expires_at"],
            "amount_centavos": it["amount_centavos"]}
