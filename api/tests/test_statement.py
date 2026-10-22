import pytest

from app.payments.statement import clean_ref, parse_statement, to_centavos


def test_clean_ref():
    assert clean_ref("1234 567-890") == "1234567890"


def test_to_centavos():
    assert to_centavos("₱1,250.50") == 125050
    assert to_centavos("PHP 850") == 85000


def test_gcash_style_with_title_rows_and_debits():
    raw = ("GCash Transaction History\nAccount: 0917 *** 4821\n"
           "Date and Time,Reference No.,Description,Debit,Credit\n"
           "2026-10-23 20:41:10,1009 876 543 210,Received from Ana R.,,850.00\n"
           "2026-10-23 20:45:00,2222222222222,Sent to Supplier,500.00,\n"
           "Total,,,,850.00\n").encode()
    rows = parse_statement(raw)
    assert len(rows) == 1
    assert rows[0]["reference"] == "1009876543210"
    assert rows[0]["amount_centavos"] == 85000


def test_bank_style_dates():
    raw = b"Transaction Date,Reference Number,Amount\n10/23/2026 08:41 PM,ABC123456,\"1,200.00\"\n"
    r = parse_statement(raw)[0]
    assert r["amount_centavos"] == 120000 and r["paid_at"].hour == 20


def test_missing_column():
    with pytest.raises(ValueError):
        parse_statement(b"foo,bar\n1,2\n")
