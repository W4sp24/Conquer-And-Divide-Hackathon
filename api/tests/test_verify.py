from datetime import datetime, timedelta, timezone

import pytest

from app.payments.verify import verify_payment

T0 = datetime(2026, 10, 23, 20, 0, tzinfo=timezone.utc)
ORDER = {"total_centavos": 85000, "claimed_at": T0}
BUYER = {"max_paid_centavos": 50000}
UNTIL = T0 + timedelta(hours=1)


def proof(ref="1234567890", at=T0 + timedelta(minutes=10)):
    return {"reference": ref, "amount_centavos": 85000, "submitted_at": at}


def pay(amt=85000, at=T0 + timedelta(minutes=8)):
    return {"amount_centavos": amt, "paid_at": at}


CASES = [
    # name, proof, payment, reused_by, statement_until, buyer, decision, reasons start with
    ("clean match", proof(), pay(), None, UNTIL, BUYER, "RELEASE", []),
    ("missing reference", proof(ref=""), None, None, UNTIL, BUYER, "HOLD", ["missing reference"]),
    ("reused reference", proof(), pay(), "order-2", UNTIL, BUYER, "HOLD", ["reused reference"]),
    ("not in statement", proof(), None, None, UNTIL, BUYER, "HOLD", ["reference not in"]),
    ("statement too old", proof(), None, None, T0, BUYER, "PENDING", ["waiting for"]),
    ("no statement yet", proof(), None, None, None, BUYER, "PENDING", ["waiting for"]),
    ("amount mismatch", proof(), pay(amt=45000), None, UNTIL, BUYER, "HOLD", ["amount mismatch"]),
    ("old transfer reused", proof(), pay(at=T0 - timedelta(days=2)), None, UNTIL, BUYER,
     "HOLD", ["payment is older"]),
    ("3x spike", proof(), pay(), None, UNTIL, {"max_paid_centavos": 20000}, "HOLD", ["unusual size"]),
    ("new buyer, no spike rule", proof(), pay(), None, UNTIL, {"max_paid_centavos": 0}, "RELEASE", []),
    ("every reason at once", proof(), pay(amt=100), "order-9", UNTIL, {"max_paid_centavos": 100},
     "HOLD", ["reused reference", "amount mismatch", "unusual size"]),
]


@pytest.mark.parametrize("name,pf,pm,reused,until,buyer,decision,starts", CASES)
def test_verify(name, pf, pm, reused, until, buyer, decision, starts):
    r = verify_payment(ORDER, pf, pm, reused, until, buyer)
    assert r.decision == decision, name
    for s in starts:
        assert any(x.startswith(s) for x in r.reasons), (name, r.reasons)
