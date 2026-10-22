"""Seller catalog: item codes, names, prices, sizes, stock and keywords."""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from app import db, views
from app.auth import seller_only
from app.orders.queue import rebalance
from app.schema import catalog_items, live_sessions, orders

router = APIRouter(tags=["catalog"])
TONES = ["#DCD5C4", "#C98A93", "#AFB8C2", "#9C6B43", "#C2AC82", "#5F82B5", "#A09775", "#4F7A6B",
         "#A5483F", "#7389A6", "#D3C1AC", "#8E8E8B", "#7E6A8E", "#B39467", "#8C7A5B"]


class ItemIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=8)
    name: str = Field(..., min_length=1, max_length=80)
    price_centavos: int = Field(..., gt=0, le=10_000_000)
    sizes: list[str] = Field(default_factory=list, max_length=12)
    stock: int = Field(1, ge=0, le=999)
    keywords: list[str] = Field(default_factory=list, max_length=20)
    photo_url: str | None = Field(None, max_length=400_000)
    tone: str | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, v):
        v = re.sub(r"[\s-]", "", v).upper()
        if not re.fullmatch(r"[A-Z]{1,2}\d{1,3}", v):
            raise ValueError("use 1-2 letters and up to 3 digits, like B12")
        return v

    @field_validator("sizes", "keywords")
    @classmethod
    def _clean_list(cls, v):
        out = []
        for x in v:
            x = x.strip()[:24]
            if x and x.lower() not in {y.lower() for y in out}:
                out.append(x)
        return out


def _check_photo(url: str | None):
    if url and not (url.startswith("data:image/") or url.startswith("https://")):
        raise HTTPException(422, "photo must be an uploaded image or an https link")


@router.get("/catalog")
async def list_items(seller=Depends(seller_only)):
    items = await db.get_catalog(seller["id"])
    return [views.item_view(i) for i in items]


@router.post("/catalog")
async def add_item(body: ItemIn, seller=Depends(seller_only)):
    _check_photo(body.photo_url)
    existing = await db.item_by_code(seller["id"], body.code)
    if existing and existing["active"]:
        raise HTTPException(409, f"{body.code} is already in your catalog")
    n = await db.fetchval(select(func.count()).select_from(catalog_items))
    vals = body.model_dump()
    vals["keywords"] = [k.lower() for k in vals["keywords"]]
    vals["tone"] = body.tone or TONES[int(n or 0) % len(TONES)]
    if existing:                                    # re-adding a deleted code revives the row
        await db.execute(update(catalog_items).where(catalog_items.c.id == existing["id"])
                         .values(active=True, **vals))
        return views.item_view(await db.get_item(existing["id"]))
    iid = db.new_id()
    try:
        await db.execute(insert(catalog_items).values(id=iid, seller_id=seller["id"], **vals))
    except IntegrityError:
        raise HTTPException(409, f"{body.code} is already in your catalog")
    return views.item_view(await db.get_item(iid))


@router.put("/catalog/{code}")
async def edit_item(code: str, body: ItemIn, seller=Depends(seller_only)):
    _check_photo(body.photo_url)
    item = await db.item_by_code(seller["id"], code)
    if not item or not item["active"]:
        raise HTTPException(404, "item not found")
    if body.code != item["code"]:
        raise HTTPException(422, "the code can't change; add a new item instead")
    vals = body.model_dump(exclude={"code"})
    vals["keywords"] = [k.lower() for k in vals["keywords"]]
    vals["tone"] = body.tone or item["tone"]
    await db.execute(update(catalog_items).where(catalog_items.c.id == item["id"]).values(**vals))
    if body.stock != item["stock"]:
        await rebalance(item["id"])               # more stock promotes the waitlist
    return views.item_view(await db.get_item(item["id"]))


@router.delete("/catalog/{code}")
async def delete_item(code: str, seller=Depends(seller_only)):
    item = await db.item_by_code(seller["id"], code)
    if not item or not item["active"]:
        raise HTTPException(404, "item not found")
    open_orders = await db.fetchval(select(func.count()).select_from(orders).where(
        orders.c.item_id == item["id"], orders.c.status.in_(("CLAIMED", "WAITLISTED", "CONFIRMED", "PROOF_SENT"))))
    if open_orders:
        raise HTTPException(409, f"{code} has {open_orders} open order(s). Finish or cancel them first")
    has_orders = await db.fetchval(select(func.count()).select_from(orders).where(orders.c.item_id == item["id"]))
    if has_orders:   # keep history: hide instead of delete
        await db.execute(update(catalog_items).where(catalog_items.c.id == item["id"]).values(active=False))
    else:
        await db.execute(update(live_sessions).where(live_sessions.c.current_item_id == item["id"])
                         .values(current_item_id=None))
        await db.execute(delete(catalog_items).where(catalog_items.c.id == item["id"]))
    return {"ok": True}
