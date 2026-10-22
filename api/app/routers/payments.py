"""Seller payment checks, packing list and order actions."""
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import db, views
from app.auth import seller_only
from app.hub import sse_events
from app.orders.states import transition
from app.payments import wallet
from app.payments.service import ask_buyer, run_check, seller_reject, seller_release, upload_statement
from app.schema import order_events, orders, statement_uploads

router = APIRouter(tags=["payments"])


async def _owned(order_id: str, seller: dict) -> dict:
    o = await db.get_order(order_id)
    if not o or o["seller_id"] != seller["id"]:
        raise HTTPException(404, "order not found")
    return o


@router.get("/seller/stream")
async def seller_stream(request: Request, seller=Depends(seller_only)):
    return StreamingResponse(sse_events(request, f"seller:{seller['id']}", {"type": "hello"}),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/payments")
async def payments_overview(seller=Depends(seller_only)):
    to_check = await views.orders_with([orders.c.seller_id == seller["id"], orders.c.status == "PROOF_SENT"],
                                       order_by=[orders.c.proof_submitted_at])
    awaiting = await views.orders_with([orders.c.seller_id == seller["id"], orders.c.status == "CONFIRMED"],
                                       order_by=[orders.c.pay_by])
    last = await db.fetchone(select(statement_uploads).where(statement_uploads.c.seller_id == seller["id"])
                             .order_by(statement_uploads.c.uploaded_at.desc()).limit(1))
    return {"to_check": to_check, "awaiting_payment": awaiting, "last_upload": last,
            "covers_until": await db.statement_until(seller["id"]),
            "green": len([o for o in to_check if o["verdict"] == "RELEASE"])}


@router.post("/payments/statement")
async def statement(file: UploadFile = File(...), seller=Depends(seller_only)):
    raw = await file.read()
    if len(raw) > 5_000_000:
        raise HTTPException(413, "statement file is over 5 MB")
    try:
        return await upload_statement(seller["id"], file.filename or "statement.csv", raw)
    except ValueError as e:
        raise HTTPException(422, f"Couldn't read this statement: {e}")


@router.get("/payments/wallet-statement.csv")
async def wallet_statement(seller=Depends(seller_only)):
    """The mock e-wallet's export (stands in for downloading a GCash statement)."""
    csv_text = await wallet.statement_csv(seller["id"])
    stamp = db.now().strftime("%Y%m%d-%H%M")
    return PlainTextResponse(csv_text, media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="demowallet-statement-{stamp}.csv"'})


@router.post("/orders/{order_id}/release")
async def release(order_id: str, seller=Depends(seller_only)):
    await _owned(order_id, seller)
    if not await seller_release(order_id):
        raise HTTPException(409, "only orders with a submitted payment can be released")
    return {"ok": True}


class RejectIn(BaseModel):
    reason: str = Field("payment not found", max_length=120)


@router.post("/orders/{order_id}/reject")
async def reject(order_id: str, body: RejectIn, seller=Depends(seller_only)):
    await _owned(order_id, seller)
    if not await seller_reject(order_id, body.reason):
        raise HTTPException(409, "only orders with a submitted payment can be rejected")
    return {"ok": True}


class AskIn(BaseModel):
    message: str = Field("Please double-check the reference number in your app and send it again.",
                         max_length=300)


@router.post("/orders/{order_id}/ask")
async def ask(order_id: str, body: AskIn, seller=Depends(seller_only)):
    await _owned(order_id, seller)
    await ask_buyer(order_id, body.message)
    return {"ok": True}


@router.post("/orders/{order_id}/recheck")
async def recheck(order_id: str, seller=Depends(seller_only)):
    await _owned(order_id, seller)
    res = await run_check(order_id)
    return {"decision": res.decision if res else None}


@router.post("/payments/release-green")
async def release_green(seller=Depends(seller_only)):
    rows = await db.fetch(select(orders.c.id).where(orders.c.seller_id == seller["id"],
                                                    orders.c.status == "PROOF_SENT",
                                                    orders.c.verdict == "RELEASE"))
    n = 0
    for r in rows:
        if await seller_release(r["id"], note="released (all green)"):
            n += 1
    return {"released": n}


@router.post("/orders/{order_id}/cancel")
async def seller_cancel(order_id: str, seller=Depends(seller_only)):
    from app.orders.queue import rebalance
    o = await _owned(order_id, seller)
    if not await transition(order_id, "CANCELLED", "seller", "cancelled by seller"):
        raise HTTPException(409, "this order can't be cancelled now")
    await rebalance(o["item_id"])
    return {"ok": True}


# ---- packing ------------------------------------------------------------------------

@router.get("/packing")
async def packing(session_id: str | None = None, seller=Depends(seller_only)):
    where = [orders.c.seller_id == seller["id"], orders.c.status.in_(("VERIFIED", "PACKED", "SHIPPED"))]
    if session_id:
        where.append(orders.c.session_id == session_id)
    rows = await views.orders_with(where, masked=False, order_by=[orders.c.updated_at])
    groups: dict[str, dict] = {}
    for o in rows:
        g = groups.setdefault(o["buyer_id"], {"buyer_id": o["buyer_id"], "buyer": o["buyer"],
                                              "label": o["buyer_label"], "orders": []})
        g["orders"].append(o)
    out = []
    for g in groups.values():
        sts = {o["status"] for o in g["orders"]}
        g["status"] = "SHIPPED" if sts == {"SHIPPED"} else ("PACKED" if sts <= {"PACKED", "SHIPPED"} else "TO_PACK")
        g["total_centavos"] = sum(o["total_centavos"] for o in g["orders"])
        g["units"] = sum(o["qty"] for o in g["orders"])
        out.append(g)
    order = {"TO_PACK": 0, "PACKED": 1, "SHIPPED": 2}
    out.sort(key=lambda g: (order[g["status"]], g["buyer"]))
    return {"groups": out, "totals": {
        "orders": len(rows), "units": sum(o["qty"] for o in rows),
        "to_pack": sum(o["qty"] for o in rows if o["status"] == "VERIFIED"),
        "collected_centavos": sum(o["total_centavos"] for o in rows)}}


class PackIn(BaseModel):
    order_ids: list[str] = Field(..., min_length=1, max_length=200)
    to: str = Field(..., pattern="^(VERIFIED|PACKED|SHIPPED)$")


@router.post("/packing/mark")
async def mark(body: PackIn, seller=Depends(seller_only)):
    """Packed / Shipped checkboxes. Ticking Shipped on an unpacked order packs it first."""
    moved = 0
    for oid in body.order_ids:
        o = await _owned(oid, seller)
        path = {("VERIFIED", "PACKED"): ["PACKED"], ("VERIFIED", "SHIPPED"): ["PACKED", "SHIPPED"],
                ("PACKED", "SHIPPED"): ["SHIPPED"], ("PACKED", "VERIFIED"): ["VERIFIED"],
                ("SHIPPED", "PACKED"): ["PACKED"], ("SHIPPED", "VERIFIED"): ["PACKED", "VERIFIED"]
                }.get((o["status"], body.to), [])
        for step in path:
            if await transition(oid, step, "seller", f"marked {step.lower()}"):
                moved += 1
    return {"moved": moved}


@router.get("/orders/{order_id}")
async def order_detail(order_id: str, seller=Depends(seller_only)):
    await _owned(order_id, seller)
    o = (await views.orders_with([orders.c.id == order_id], masked=False))[0]
    o["events"] = await db.fetch(select(order_events).where(order_events.c.order_id == order_id)
                                 .order_by(order_events.c.id))
    return o


@router.get("/orders")
async def list_orders(session_id: str | None = None, status: str | None = None, seller=Depends(seller_only)):
    where = [orders.c.seller_id == seller["id"]]
    if session_id:
        where.append(orders.c.session_id == session_id)
    if status:
        where.append(orders.c.status.in_(status.upper().split(",")))
    return await views.orders_with(where, masked=False, order_by=[orders.c.claimed_at.desc()])
