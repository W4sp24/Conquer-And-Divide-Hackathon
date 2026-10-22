"""End-to-end API flow: comments -> queue -> buyer confirm -> payment -> verify -> packing."""
import io
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app import db
from app.main import app
from app.schema import orders
from app.sources import runner

H = {"X-Seller-Key": "test-key"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def comment(c, sid, name, msg):
    r = c.post(f"/api/sessions/{sid}/comments", json={"name": name, "message": msg}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["parsed"]


def board(c, sid):
    return c.get(f"/api/sessions/{sid}/board", headers=H).json()


def item(b, code):
    return next(i for i in b["items"] if i["code"] == code)


def order_of(c, sid, code, buyer_prefix):
    rows = c.get(f"/api/orders?session_id={sid}", headers=H).json()
    return next(o for o in rows if o["item_code"] == code and o["buyer"].startswith(buyer_prefix))


@pytest.fixture(scope="module")
def sid(client):
    r = client.post("/api/sessions", json={"title": "Test live", "source": "chat"}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_auth_required(client):
    assert client.get("/api/sessions").status_code == 401


def test_claim_waitlist_and_cancel_promotes(client, sid):
    p = comment(client, sid, "Ana Reyes", "mine B12")
    assert p["stage"] == "rules" and p["outcome"] == "claimed B12"
    p = comment(client, sid, "Mark Dela Cruz", "mine B12 po")
    assert p["outcome"].startswith("waitlisted B12")
    b = item(board(client, sid), "B12")
    assert [o["buyer"] for o in b["claimed"]] == ["Ana R."]
    assert [o["buyer"] for o in b["waitlist"]] == ["Mark D."]
    p = comment(client, sid, "Ana Reyes", "cancel B12")
    assert p["outcome"] == "cancelled B12"
    b = item(board(client, sid), "B12")
    assert [o["buyer"] for o in b["claimed"]] == ["Mark D."]


def test_duplicate_claim_ignored(client, sid):
    p = comment(client, sid, "Mark Dela Cruz", "mine B12!!")
    assert p["outcome"] == "already in line for B12"


def test_bare_claim_uses_on_camera(client, sid):
    assert client.put(f"/api/sessions/{sid}/on-camera", json={"item_code": "B4"}, headers=H).status_code == 200
    p = comment(client, sid, "Liza Santos", "mine po")
    assert p["outcome"] == "claimed B4"


def test_fuzzy_description(client, sid):
    p = comment(client, sid, "Rhea Bautista", "mine blu polo M po")
    assert p["stage"] == "fuzzy" and p["result"]["item_code"] == "B7"
    assert p["result"]["size"] == "M"


def test_chat_is_ignored_and_unclear_goes_to_review(client, sid):
    assert comment(client, sid, "Joy Cruz", "ganda ate!")["stage"] == "ignored"
    p = comment(client, sid, "Joy Cruz", "mine yung ano po basta")
    assert p["stage"] == "review"
    rv = board(client, sid)["review"]
    assert any(r["id"] == p["comment_id"] for r in rv)
    r = client.post(f"/api/comments/{p['comment_id']}/fix",
                    json={"intent": "claim", "item_code": "B1", "size": "S", "qty": 1}, headers=H)
    assert r.status_code == 200 and r.json()["outcome"] == "claimed B1"
    assert not any(x["id"] == p["comment_id"] for x in board(client, sid)["review"])


def test_manual_payment_flow(client, sid):
    o = order_of(client, sid, "B12", "Mark")
    tok = o["buyer_token"]
    pub = client.get(f"/api/buyer/{tok}").json()
    assert pub["status"] == "CLAIMED" and pub["item"]["code"] == "B12"
    assert "Ana" not in str(pub)                      # never other buyers' data
    r = client.post(f"/api/buyer/{tok}/confirm", json={"size": "L"})
    assert r.status_code == 200 and r.json()["status"] == "CONFIRMED"
    seller_id = r.json()["payment"]["seller_id"]
    pay = client.post(f"/api/wallet/{seller_id}/send",
                      json={"amount_centavos": 85000, "sender_name": "Mark Dela Cruz"}).json()
    r = client.post(f"/api/buyer/{tok}/proof", json={"reference": pay["reference"], "attested": True})
    assert r.status_code == 200 and r.json()["status"] == "PROOF_SENT"
    pending = client.get("/api/payments", headers=H).json()["to_check"]
    assert next(x for x in pending if x["buyer_token"] == tok)["verdict"] == "PENDING"


def test_fake_reference_held_and_statement_flip(client, sid):
    o = order_of(client, sid, "B4", "Liza")
    tok = o["buyer_token"]
    assert client.post(f"/api/buyer/{tok}/confirm", json={"size": "M"}).status_code == 200
    assert client.post(f"/api/buyer/{tok}/proof", json={"reference": "9999 0000 1111", "attested": True}).status_code == 200
    csv_text = client.get("/api/payments/wallet-statement.csv", headers=H).text
    assert "Reference No." in csv_text
    r = client.post("/api/payments/statement", headers=H,
                    files={"file": ("statement.csv", io.BytesIO(csv_text.encode()), "text/csv")})
    assert r.status_code == 200, r.text
    to_check = {x["buyer"]: x for x in client.get("/api/payments", headers=H).json()["to_check"]}
    assert to_check["Mark Dela Cruz"]["verdict"] == "RELEASE"
    assert to_check["Liza Santos"]["verdict"] == "HOLD"
    assert to_check["Liza Santos"]["verdict_reasons"][0].startswith("reference not in")
    assert client.post("/api/payments/release-green", headers=H).json()["released"] == 1
    assert client.post(f"/api/orders/{to_check['Liza Santos']['id']}/reject",
                       json={"reason": "reference not in statement"}, headers=H).status_code == 200
    assert client.get(f"/api/buyer/{tok}").json()["status"] == "CONFIRMED"
    buyers = {b["name"]: b for b in client.get("/api/buyers", headers=H).json()}
    assert buyers["Liza Santos"]["label"] == "HOLD"


def test_reused_reference(client, sid):
    mark = order_of(client, sid, "B12", "Mark")
    ref = client.get(f"/api/orders/{mark['id']}", headers=H).json()["proof_reference"]
    o = order_of(client, sid, "B7", "Rhea")
    assert client.post(f"/api/buyer/{o['buyer_token']}/confirm", json={}).status_code == 200
    client.post(f"/api/buyer/{o['buyer_token']}/proof", json={"reference": ref, "attested": True})
    d = client.get(f"/api/orders/{o['id']}", headers=H).json()
    assert d["verdict"] == "HOLD" and any(r.startswith("reused reference") for r in d["verdict_reasons"])


def test_instant_qr_flow(client, sid):
    o = order_of(client, sid, "B1", "Joy")
    tok = o["buyer_token"]
    client.post(f"/api/buyer/{tok}/confirm", json={"size": "S"})
    qr = client.post(f"/api/buyer/{tok}/qr").json()
    info = client.get(f"/api/gateway/intents/{qr['intent_id']}").json()
    assert info["status"] == "awaiting_payment" and info["amount_centavos"] == 25000
    r = client.post(f"/api/gateway/intents/{qr['intent_id']}/pay", json={"payer_name": "Joy"})
    assert r.status_code == 200 and r.json()["status"] == "paid"
    assert client.get(f"/api/buyer/{tok}").json()["status"] == "VERIFIED"   # auto-released
    assert client.post(f"/api/gateway/intents/{qr['intent_id']}/pay", json={}).json()["status"] == "paid"


def test_webhook_rejects_bad_signature(client):
    r = client.post("/api/webhooks/qrph", content=b'{"data":{}}', headers={"X-MockPay-Signature": "t=1,te=bad"})
    assert r.status_code == 401


def test_packing(client, sid):
    p = client.get("/api/packing", headers=H).json()
    assert {g["buyer"] for g in p["groups"]} == {"Mark Dela Cruz", "Joy Cruz"}
    ids = [o["id"] for g in p["groups"] for o in g["orders"]]
    assert client.post("/api/packing/mark", json={"order_ids": ids, "to": "SHIPPED"}, headers=H).json()["moved"] == 4
    assert all(g["status"] == "SHIPPED" for g in client.get("/api/packing", headers=H).json()["groups"])


def test_hold_expires_and_promotes(client, sid):
    comment(client, sid, "Ben Tan", "mine B9")
    comment(client, sid, "Cara Lim", "mine B9")
    o = order_of(client, sid, "B9", "Ben")

    async def past():
        await db.execute(update(orders).where(orders.c.id == o["id"]).values(hold_until=db.now()))
    client.portal.call(past)
    time.sleep(0.8)
    b = item(board(client, sid), "B9")
    assert [x["buyer"] for x in b["claimed"]] == ["Cara L."]
    assert client.get(f"/api/buyer/{o['buyer_token']}").json()["status"] == "EXPIRED"


def test_insights_and_export(client, sid):
    ins = client.get(f"/api/insights?session_id={sid}", headers=H).json()
    assert ins["funnel"][0]["count"] >= 5 and ins["verified"] == 2
    exp = client.get(f"/api/sessions/{sid}/export", headers=H)
    assert exp.status_code == 200 and "mine B12" in exp.text


def test_viewer_chat_and_privacy(client, sid):
    r = client.post(f"/api/public/sessions/{sid}/comments",
                    json={"device_id": "device-abc-123", "name": "Kim Uy", "message": "mine B20 XL"})
    assert r.status_code == 200
    client.portal.call(runner.drain)
    info = client.get(f"/api/public/sessions/{sid}").json()
    assert all(" " not in c["name"] or c["name"].endswith(".") for c in info["comments"])
    mine = client.get(f"/api/public/sessions/{sid}/my-orders?device_id=device-abc-123").json()
    assert mine and mine[0]["item_code"] == "B20"


def test_delete_buyer_data(client, sid):
    b = next(x for x in client.get("/api/buyers", headers=H).json() if x["name"] == "Kim Uy")
    assert client.delete(f"/api/buyers/{b['id']}", headers=H).status_code == 200
    assert not any(x["name"] == "Kim Uy" for x in client.get("/api/buyers", headers=H).json())
