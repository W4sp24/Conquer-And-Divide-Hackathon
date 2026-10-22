"""Glue around verify_payment: submit proof, run checks, statement upload, release, reject."""
from datetime import timedelta

from rapidfuzz import fuzz, process
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from app import db
from app.hub import hub
from app.orders.queue import bump_buyer
from app.orders.states import publish_order, transition
from app.payments.statement import clean_ref, parse_statement, statement_as_of
from app.payments.verify import verify_payment
from app.schema import orders, payments, proofs, statement_uploads


async def submit_proof(order: dict, reference: str, amount_centavos: int | None, attested: bool,
                       channel: str = "manual", actor: str = "buyer") -> dict | None:
    ref = clean_ref(reference)
    if not 6 <= len(ref) <= 32:
        raise ValueError("reference numbers have 6 to 32 letters or digits")
    amount = amount_centavos or order["total_centavos"]
    now = db.now()
    try:
        await db.execute(insert(proofs).values(id=db.new_id(), seller_id=order["seller_id"],
                                               order_id=order["id"], reference=ref,
                                               amount_centavos=amount, attested=attested,
                                               submitted_at=now))
    except IntegrityError:
        pass                              # run_check reports it as reused (or it is this order's own)
    row = await transition(order["id"], "PROOF_SENT", actor,
                           "proof submitted" if channel == "manual" else "QR Ph payment confirmed",
                           proof_reference=ref, proof_amount_centavos=amount, proof_submitted_at=now,
                           proof_attested=attested, proof_channel=channel, seller_note=None)
    if row:
        await run_check(order["id"])
    return row


async def run_check(order_id: str):
    o = await db.get_order(order_id)
    if not o or o["status"] != "PROOF_SENT":
        return None
    ref = o["proof_reference"]
    proof = ({"reference": ref, "amount_centavos": o["proof_amount_centavos"],
              "submitted_at": o["proof_submitted_at"]} if ref else None)
    owner = payment = near = None
    if ref:
        owner = await db.fetchval(select(proofs.c.order_id).where(
            proofs.c.seller_id == o["seller_id"], proofs.c.reference == ref))
        pays = await db.fetch(select(payments).where(payments.c.seller_id == o["seller_id"],
                                                     payments.c.reference == ref))
        # a gateway payment made for this exact order wins over a statement row
        payment = next((p for p in pays if p["order_id"] == order_id), None) or (pays[0] if pays else None)
        if payment is None:
            used = select(proofs.c.reference).where(proofs.c.seller_id == o["seller_id"])
            refs = [r["reference"] for r in await db.fetch(
                select(payments.c.reference).where(payments.c.seller_id == o["seller_id"],
                                                   payments.c.reference.not_in(used)))]
            hit = process.extractOne(ref, refs, scorer=fuzz.ratio, score_cutoff=85) if refs else None
            near = hit[0] if hit else None
    res = verify_payment(o, proof, payment,
                         reused_by=owner if owner and owner != order_id else None,
                         statement_until=await db.statement_until(o["seller_id"]),
                         buyer=await db.get_buyer(o["buyer_id"]), near_ref=near)
    await db.execute(update(orders).where(orders.c.id == order_id).values(
        verdict=res.decision, verdict_reasons=res.reasons, verdict_suggestion=res.suggestion))
    ev = {"type": "verdict", "order_id": order_id, "decision": res.decision,
          "reasons": res.reasons, "suggestion": res.suggestion}
    await hub.publish(f"session:{o['session_id']}", ev)
    await hub.publish(f"seller:{o['seller_id']}", ev)
    return res


async def upload_statement(seller_id: str, filename: str, raw: bytes) -> dict:
    rows = parse_statement(raw)
    covers = max(r["paid_at"] for r in rows)
    as_of = statement_as_of(raw)
    if as_of:
        as_of += timedelta(seconds=1)     # exports print whole seconds: cover the full second
        if as_of > covers:
            covers = min(as_of, db.now())  # never trust a future "as of"
    upload_id = db.new_id()
    await db.execute(insert(statement_uploads).values(
        id=upload_id, seller_id=seller_id, filename=filename, row_count=len(rows), covers_until=covers))
    added = 0
    for r in rows:                         # re-uploading a file adds no duplicates
        try:
            await db.execute(insert(payments).values(id=db.new_id(), seller_id=seller_id, source="statement",
                                                     upload_id=upload_id, **r))
            added += 1
        except IntegrityError:
            pass
    checked = []
    for o in await db.fetch(select(orders.c.id).where(orders.c.seller_id == seller_id,
                                                      orders.c.status == "PROOF_SENT")):
        res = await run_check(o["id"])     # this is the live "flip" in the demo
        if res:
            checked.append(res.decision)
    return {"rows": len(rows), "new_payments": added, "checked": len(checked),
            "release": checked.count("RELEASE"), "hold": checked.count("HOLD"),
            "pending": checked.count("PENDING")}


async def seller_release(order_id: str, actor: str = "seller", note: str = "released") -> dict | None:
    o = await transition(order_id, "VERIFIED", actor, note)
    if o:
        await bump_buyer(o["buyer_id"], verified=1, paid_centavos=o["total_centavos"])
    return o


async def seller_reject(order_id: str, reason: str) -> dict | None:
    o = await transition(order_id, "CONFIRMED", "seller", f"proof rejected: {reason}",
                         verdict=None, verdict_reasons=[], verdict_suggestion=None,
                         # the buyer never sees the reason: the system doesn't accuse anyone on screen
                         seller_note="The seller couldn't match this payment yet. "
                                     "Please check your app and send the reference again.")
    if o:
        await bump_buyer(o["buyer_id"], failed_proofs=1)
    return o


async def ask_buyer(order_id: str, message: str) -> dict | None:
    o = await db.get_order(order_id)
    if not o:
        return None
    await db.execute(update(orders).where(orders.c.id == order_id).values(seller_note=message[:300]))
    o = await db.get_order(order_id)
    await publish_order(o, {"asked": True})
    return o
