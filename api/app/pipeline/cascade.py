"""The parsing cascade: rules -> RapidFuzz -> LLM -> needs review.

Cheapest first; stops at the first step that is sure. Anything still unsure lands in the
needs-review bucket instead of becoming a wrong order.
"""
import logging

from rapidfuzz import fuzz, process
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from app import db
from app.hub import hub
from app.pipeline.fuzzy import build_choices, fuzzy_match
from app.pipeline.llm import llm_enabled, llm_parse
from app.pipeline.rules import parse_rules, pick_size
from app.schema import buyers, comments, corrections, orders

log = logging.getLogger("cascade")

ACCEPT = 88          # fuzzy score that settles the item on its own (needs a claim word)
CANDIDATE = 70       # fuzzy score worth asking the LLM about
AMBIGUOUS_GAP = 5    # two items this close = not sure which one
REVIEW_BELOW = 0.75  # final confidence below this goes to review


async def classify(message: str, catalog: list[dict], on_camera: dict | None, ctx_fn=None,
                   llm=llm_parse) -> tuple[str, dict | None, list]:
    """Pure-ish decision: returns (stage, result, fuzzy_hits). ctx_fn(hits) builds LLM context."""
    codes = {i["code"].upper() for i in catalog}
    r = parse_rules(message, codes, on_camera["code"] if on_camera else None)
    stage, result, hits = "rules", r, []
    if r is None or r["confidence"] < 0.9:
        hits = fuzzy_match(message, build_choices(catalog))
        top_code, top_score = hits[0] if hits else (None, 0)
        second = hits[1][1] if len(hits) > 1 else 0
        clear_winner = top_score >= ACCEPT and top_score - second >= AMBIGUOUS_GAP
        if r and r["intent"] in ("claim", "waitlist") and clear_winner:
            stage, result = "fuzzy", {**r, "item_code": top_code, "confidence": round(top_score / 100, 2)}
        elif (r is not None or top_score >= CANDIDATE) and llm_enabled():
            ctx = await ctx_fn(hits) if ctx_fn else {"candidates": [], "recent_items": []}
            p = await llm(message, ctx)
            stage, result = "llm", (p.model_dump() if p else None)
            if p and p.intent in ("question", "other"):
                stage = "ignored" if p.confidence >= REVIEW_BELOW else "review"
        elif r is not None:
            stage, result = "review", r          # order word but no sure item, and no LLM
        else:
            stage, result = "ignored", None      # chat, greetings, questions
    if stage not in ("ignored",) and (result is None or result["confidence"] < REVIEW_BELOW):
        stage = "review"
    if stage == "review" and result is None and r is not None:
        result = r
    return stage, result, hits


async def upsert_buyer(seller_id: str, user_id: str, name: str) -> dict:
    q = select(buyers).where(buyers.c.seller_id == seller_id, buyers.c.platform_user_id == user_id)
    b = await db.fetchone(q)
    if b:
        if name and b["display_name"] != name:
            await db.execute(update(buyers).where(buyers.c.id == b["id"]).values(display_name=name))
            b["display_name"] = name
        return b
    try:
        await db.execute(insert(buyers).values(id=db.new_id(), seller_id=seller_id,
                                               platform_user_id=user_id, display_name=name or "Viewer"))
    except IntegrityError:
        pass
    return await db.fetchone(q)


async def llm_context(s: dict, catalog: list[dict], buyer: dict, hits: list, message: str) -> dict:
    by_code = {i["code"]: i for i in catalog}
    by_id = {i["id"]: i for i in catalog}
    brief = lambda i: {"code": i["code"], "name": i["name"], "sizes": i["sizes"]}  # noqa: E731
    on_cam = by_id.get(s.get("current_item_id"))
    recent = [brief(by_id[i]) for i in (s.get("recent_item_ids") or [])[-5:] if i in by_id]
    cands = [brief(by_code[c]) for c, _ in hits if c in by_code]
    if not cands:
        cands = [brief(i) for i in catalog[:20]]
    rows = await db.fetch(select(orders.c.item_id).where(orders.c.buyer_id == buyer["id"],
                                                          orders.c.session_id == s["id"]))
    claims = [by_id[r["item_id"]]["code"] for r in rows if r["item_id"] in by_id]
    ex = await db.fetch(select(corrections).where(corrections.c.seller_id == s["seller_id"])
                        .order_by(corrections.c.id.desc()).limit(200))
    if len(ex) > 30:
        top = process.extract(message, [e["message"] for e in ex], scorer=fuzz.WRatio, limit=10)
        ex = [ex[i] for _, _, i in top]
    examples = [{"comment": e["message"], "answer": e["fixed"]} for e in ex]
    return {"on_camera": brief(on_cam) if on_cam else None, "recent_items": recent,
            "candidates": cands, "buyer_claims": claims[-5:], "examples": examples}


async def process_comment(session_id: str, c: dict) -> dict | None:
    """c = {id, user_id, name, message, created_time, source}. Returns the parse summary."""
    from app.orders.queue import apply_intent  # local import: queue imports cascade helpers

    s = await db.get_session(session_id)
    if not s:
        return None
    catalog = await db.get_catalog(s["seller_id"])
    buyer = await upsert_buyer(s["seller_id"], str(c.get("user_id") or c["name"]), c["name"])
    try:
        await db.execute(insert(comments).values(
            id=c["id"], session_id=session_id, buyer_id=buyer["id"], message=c["message"][:500],
            source=c.get("source", "chat"), created_time=c["created_time"]))
    except IntegrityError:
        return None                                    # already processed (Meta resend / replay)

    on_camera = next((i for i in catalog if i["id"] == s.get("current_item_id")), None)

    async def ctx_fn(hits):
        return await llm_context(s, catalog, buyer, hits, c["message"])

    try:
        stage, result, _ = await classify(c["message"], catalog, on_camera, ctx_fn)
    except Exception:                                  # a parser bug must never kill the live
        log.exception("classify failed")
        stage, result = "review", None

    # item-aware size: "28", "Free size", "XL" checked against the claimed item's own sizes
    if result and result.get("item_code"):
        item = next((i for i in catalog if i["code"].upper() == result["item_code"].upper()), None)
        if item:
            result["item_code"] = item["code"]
            sizes = item["sizes"] or []
            if result.get("size") not in sizes:
                result["size"] = pick_size(c["message"], sizes) or (sizes[0] if len(sizes) == 1 else None)

    outcome = None
    if stage not in ("review", "ignored") and result:
        outcome = await apply_intent(s, buyer, c, result)
    await db.execute(update(comments).where(comments.c.id == c["id"]).values(
        parse_stage=stage, parse_result=result,
        confidence=(result or {}).get("confidence"), outcome=outcome))
    ev = {"type": "parsed", "comment_id": c["id"], "stage": stage, "result": result, "outcome": outcome}
    await hub.publish(f"session:{session_id}", ev)
    await hub.publish(f"viewer:{session_id}", {"type": "parsed", "comment_id": c["id"], "stage": stage,
                                               "outcome": outcome})
    return ev


async def fix_comment(comment_id: str, fixed: dict, seller_id: str) -> dict:
    """Seller fixes a review item: save the correction (future LLM example), then apply it."""
    from app.orders.queue import apply_intent

    c = await db.fetchone(select(comments).where(comments.c.id == comment_id))
    if not c:
        raise LookupError("comment not found")
    s = await db.get_session(c["session_id"])
    buyer = await db.get_buyer(c["buyer_id"])
    clean = {"intent": fixed.get("intent", "claim"), "item_code": fixed.get("item_code"),
             "size": fixed.get("size"), "qty": int(fixed.get("qty") or 1),
             "for_name": fixed.get("for_name"), "confidence": 1.0}
    await db.execute(insert(corrections).values(seller_id=seller_id, message=c["message"],
                                                fixed={k: v for k, v in clean.items() if k != "confidence"}))
    outcome = None
    if clean["intent"] in ("claim", "waitlist", "cancel"):
        outcome = await apply_intent(s, buyer, {"id": c["id"], "created_time": c["created_time"]}, clean)
    await db.execute(update(comments).where(comments.c.id == comment_id).values(
        parse_stage="fixed", parse_result=clean, confidence=1.0, resolved=True, outcome=outcome))
    ev = {"type": "parsed", "comment_id": comment_id, "stage": "fixed", "result": clean, "outcome": outcome}
    await hub.publish(f"session:{c['session_id']}", ev)
    return ev


async def dismiss_comment(comment_id: str) -> None:
    c = await db.fetchone(select(comments).where(comments.c.id == comment_id))
    if not c:
        raise LookupError("comment not found")
    await db.execute(update(comments).where(comments.c.id == comment_id).values(resolved=True))
    await hub.publish(f"session:{c['session_id']}", {"type": "parsed", "comment_id": comment_id,
                                                      "stage": "dismissed", "result": None, "outcome": None})

