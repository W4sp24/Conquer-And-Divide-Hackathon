"""Mock e-wallet ("DemoWallet"): a stand-in for the seller's own GCash/Maya account.

Used by the Manual payment mode in the demo:
  buyer scans the seller's static QR -> sends money here -> gets a receipt with a
  13-digit reference (like GCash) -> types that reference on the order page.
  Later the seller downloads this wallet's statement CSV and uploads it on Payments,
  exactly like exporting a real GCash for Business statement.
The order system never reads this table directly: it only learns about money through
the uploaded statement, the same as in the real world.
"""
import csv
import io
import secrets

from sqlalchemy import insert, select

from app import db
from app.payments.statement import MANILA
from app.schema import wallet_ledger


async def send_money(seller_id: str, amount_centavos: int, sender_name: str, message: str | None) -> dict:
    if amount_centavos <= 0 or amount_centavos > 10_000_000:
        raise ValueError("enter an amount between ₱1 and ₱100,000")
    ref = "".join(secrets.choice("0123456789") for _ in range(13))
    row_id = db.new_id()
    await db.execute(insert(wallet_ledger).values(
        id=row_id, seller_id=seller_id, reference=ref, amount_centavos=amount_centavos,
        sender_name=(sender_name or "Anonymous")[:60], message=(message or "")[:120], paid_at=db.now()))
    return await db.fetchone(select(wallet_ledger).where(wallet_ledger.c.id == row_id))


async def statement_csv(seller_id: str) -> str:
    rows = await db.fetch(select(wallet_ledger).where(wallet_ledger.c.seller_id == seller_id)
                          .order_by(wallet_ledger.c.paid_at))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["DemoWallet transaction history"])
    w.writerow([f"Statement as of: {db.now().astimezone(MANILA):%Y-%m-%d %H:%M:%S}"])
    w.writerow(["Date and Time", "Reference No.", "Description", "Debit", "Credit"])
    for r in rows:
        when = r["paid_at"].astimezone(MANILA).strftime("%Y-%m-%d %H:%M:%S")
        w.writerow([when, r["reference"], f"Received from {r['sender_name']}", "",
                    f"{r['amount_centavos'] / 100:.2f}"])
    return buf.getvalue()
