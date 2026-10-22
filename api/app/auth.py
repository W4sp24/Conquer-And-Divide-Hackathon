"""Demo seller key. Real login is out of scope for the hackathon (said so in the README)."""
import hmac

from fastapi import Header, HTTPException, Query

from app import db
from app.config import settings


async def seller_only(x_seller_key: str | None = Header(None), key: str | None = Query(None)) -> dict:
    # EventSource can't send headers, so SSE streams pass the key as ?key=
    given = x_seller_key or key or ""
    if not hmac.compare_digest(given.encode(), settings.seller_key.encode()):
        raise HTTPException(401, "seller key required")
    seller = await db.get_seller()
    if not seller:
        raise HTTPException(503, "no seller set up yet")
    return seller
