"""Seller statement CSV (GCash / Maya / bank export) -> payment rows.

Column names differ per wallet and bank, so each column is found by a list of known
header names. Only money coming in is kept.
"""
import csv
import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

REF_COLS = {"reference no.", "reference no", "reference number", "ref no", "ref no.", "reference",
            "transaction id", "transaction no.", "ref. no.", "trace no."}
AMT_COLS = {"amount", "credit", "amount (php)", "credit amount", "money in", "received"}
TIME_COLS = {"date", "date and time", "transaction date", "date/time", "datetime", "posted date"}
TIME_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y %I:%M %p",
                "%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S", "%b %d, %Y %I:%M %p", "%Y-%m-%d")
try:
    MANILA = ZoneInfo("Asia/Manila")
except Exception:  # Windows without tzdata: Manila has no DST, a fixed +08:00 is exact
    from datetime import timedelta, timezone
    MANILA = timezone(timedelta(hours=8), "Asia/Manila")


def clean_ref(s: str) -> str:
    """'1234 567-890' -> '1234567890'"""
    return re.sub(r"[^0-9A-Za-z]", "", s or "").upper()


def to_centavos(s: str) -> int:
    s = str(s).replace("₱", "").replace("PHP", "").replace("Php", "").replace(",", "").strip()
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return int((Decimal(s) * 100).quantize(Decimal("1")))
    except InvalidOperation:
        raise ValueError(f"bad amount: {s!r}")


def parse_time(s: str) -> datetime:
    s = s.strip()
    try:
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=MANILA)
    except ValueError:
        pass
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=MANILA)
        except ValueError:
            pass
    raise ValueError(f"unknown date format: {s!r}")


def _col(header: list[str], names: set[str]) -> int:
    for i, h in enumerate(header):
        if h.strip().lower() in names:
            return i
    raise ValueError(f"statement is missing a column like {sorted(names)[:4]}")


def parse_statement(raw: bytes) -> list[dict]:
    text = raw.decode("utf-8-sig", errors="replace")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(cell.strip() for cell in r)]
    if not rows:
        raise ValueError("the file is empty")
    # some exports put a title block above the header: find the first row with a reference column
    start = next((i for i, r in enumerate(rows[:15])
                  if any(c.strip().lower() in REF_COLS for c in r)), 0)
    head = rows[start]
    ri, ai, ti = _col(head, REF_COLS), _col(head, AMT_COLS), _col(head, TIME_COLS)
    out = []
    for r in rows[start + 1:]:
        if len(r) <= max(ri, ai, ti) or not r[ri].strip() or not r[ai].strip():
            continue
        try:
            amount = to_centavos(r[ai])
            paid_at = parse_time(r[ti])
        except ValueError:
            continue                      # skip footer/total lines
        if amount <= 0:
            continue                      # money in only
        out.append({"reference": clean_ref(r[ri]), "amount_centavos": amount, "paid_at": paid_at})
    if not out:
        raise ValueError("no incoming payments found in the file")
    return out


AS_OF = re.compile(r"(?:as of|generated(?: on)?|period end(?:ing)?|until|to)\s*:?\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?|\d{1,2}/\d{1,2}/\d{4}(?: \d{1,2}:\d{2}(?: [AP]M)?)?)", re.I)


def statement_as_of(raw: bytes) -> datetime | None:
    """The 'as of' time in the export's title block, if any. A statement exported at 9:05 PM
    covers every payment up to 9:05 PM, even if the last payment came in at 8:41 PM."""
    head = raw.decode("utf-8-sig", errors="replace").splitlines()[:8]
    for line in head:
        m = AS_OF.search(line)
        if m:
            try:
                return parse_time(m.group(1))
            except ValueError:
                return None
    return None
