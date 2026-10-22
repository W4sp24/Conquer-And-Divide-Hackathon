"""Buyer labels, computed on read from the counters on `buyers` (never stored)."""


def label(b: dict) -> str:
    if b["failed_proofs"] >= 1 or b["expired_unpaid"] >= 3:
        return "HOLD"
    if b["claims"] >= 3 and (b["expired_unpaid"] + b["cancels"]) / b["claims"] >= 0.34:
        return "WATCH"
    if b["verified"] >= 3 and b["failed_proofs"] == 0:
        return "TRUSTED"
    return "NEW"


LABEL_NOTES = {
    "HOLD": "Failed a payment check, or let 3+ orders expire unpaid",
    "WATCH": "A third or more of their claims were cancelled or expired",
    "TRUSTED": "3+ verified payments and no failed checks",
    "NEW": "Not enough history yet",
}
