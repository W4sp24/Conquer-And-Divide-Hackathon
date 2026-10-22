"""verify_payment: one pure function. Everything it needs is passed in; it returns
RELEASE, HOLD or PENDING with every reason found. It never reads a screenshot and never
moves the order by itself: the seller's tap does that (or the gateway, for Instant QR).
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta


@dataclass
class Result:
    decision: str                     # RELEASE | HOLD | PENDING
    reasons: list[str] = field(default_factory=list)
    suggestion: str | None = None     # "did you mean ..." for the seller only


def peso(c: int) -> str:
    return f"₱{c / 100:,.2f}"


def verify_payment(order: dict, proof: dict | None, payment: dict | None,
                   reused_by: str | None, statement_until: datetime | None,
                   buyer: dict, near_ref: str | None = None) -> Result:
    """
    order:   total_centavos, claimed_at
    proof:   reference, amount_centavos, submitted_at (what the buyer typed)
    payment: the payments row with the same reference, or None
    reused_by: another order id that already holds this reference, or None
    statement_until: newest payment time covered by uploads, or None
    buyer:   max_paid_centavos
    """
    if not proof or not proof.get("reference"):
        return Result("HOLD", ["missing reference"])
    hard, soft = [], []
    if reused_by:
        hard.append("reused reference: already used on another order")
    if payment is None:
        statement_is_older = statement_until is None or proof["submitted_at"] > statement_until
        if statement_is_older and not hard:
            return Result("PENDING", ["waiting for a newer statement"], suggestion=near_ref)
        if not statement_is_older:
            hard.append("reference not in your statement")
    else:
        if payment["amount_centavos"] != order["total_centavos"]:
            hard.append(f"amount mismatch: paid {peso(payment['amount_centavos'])}, "
                        f"order {peso(order['total_centavos'])}")
        if payment["paid_at"] < order["claimed_at"] - timedelta(minutes=5):
            hard.append("payment is older than the order")   # an old real transfer reused
    top = buyer.get("max_paid_centavos") or 0
    if top and order["total_centavos"] > 3 * top:
        soft.append("unusual size: over 3x this buyer's biggest paid order")
    if hard or soft:
        return Result("HOLD", hard + soft, suggestion=near_ref)
    return Result("RELEASE", ["reference found, amount matches"])
