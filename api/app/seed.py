"""Demo seed: Jessa's ukay shop in Tondo, items B1 to B20 (prices from ₱150 to ₱850)."""
from sqlalchemy import insert

from app import db
from app.schema import catalog_items, sellers

CATALOG = [
    ("B1", "White linen shirt", 250, ["S", "M", "L"], 3, ["white", "linen", "puti", "polo shirt"], "#DCD5C4"),
    ("B2", "Black slacks", 300, ["28", "30", "32"], 2, ["black", "slacks", "itim", "pants"], "#3A3833"),
    ("B3", "Floral dress", 280, ["S", "M"], 1, ["floral", "dress", "bestida", "bulaklak"], "#C98A93"),
    ("B4", "Striped tee", 150, ["M", "L"], 4, ["striped", "tee", "guhit", "stripes"], "#AFB8C2"),
    ("B5", "Corduroy skirt", 320, ["S", "M"], 1, ["corduroy", "skirt", "brown", "palda"], "#9C6B43"),
    ("B6", "Knit cardigan", 380, ["Free size"], 2, ["knit", "cardigan", "sweater"], "#C2AC82"),
    ("B7", "Blue polo", 350, ["M", "L"], 2, ["blue", "polo", "asul"], "#5F82B5"),
    ("B8", "Cargo shorts", 220, ["30", "32", "34"], 3, ["cargo", "shorts", "khaki", "short"], "#A09775"),
    ("B9", "Vintage windbreaker", 650, ["L"], 1, ["windbreaker", "jacket", "vintage"], "#4F7A6B"),
    ("B10", "Plaid flannel", 290, ["M", "L", "XL"], 2, ["plaid", "flannel", "checkered", "checkerd"], "#A5483F"),
    ("B11", "Mom jeans", 450, ["26", "28", "30"], 2, ["jeans", "maong", "mom jeans"], "#7389A6"),
    ("B12", "Denim jacket", 850, ["M", "L"], 1, ["denim jacket", "jacket", "maong jacket"], "#3F5B7E"),
    ("B13", "Satin blouse", 260, ["S", "M"], 2, ["satin", "blouse", "cream"], "#D3C1AC"),
    ("B14", "Gray hoodie", 420, ["M", "L", "XL"], 3, ["hoodie", "gray", "grey", "abo"], "#8E8E8B"),
    ("B15", "Pleated midi skirt", 340, ["S", "M"], 1, ["pleated", "midi", "skirt"], "#7E6A8E"),
    ("B16", "Band graphic tee", 180, ["L", "XL"], 2, ["band", "graphic tee", "band shirt"], "#2F2E2C"),
    ("B17", "Leather belt", 150, ["Free size"], 4, ["belt", "leather", "sinturon"], "#6A4A33"),
    ("B18", "Trench coat", 780, ["M"], 1, ["trench", "coat", "beige"], "#B39467"),
    ("B19", "Sweater vest", 240, ["M", "L"], 2, ["vest", "sweater vest"], "#8C7A5B"),
    ("B20", "Track jacket", 520, ["L", "XL"], 1, ["track jacket", "navy", "track"], "#2E4A7A"),
]


async def seed_if_empty():
    if await db.get_seller():
        return
    sid = db.new_id()
    await db.execute(insert(sellers).values(
        id=sid, name="Jessa", shop_name="Jessa's Ukay, Tondo", payment_mode="both",
        wallet_provider="GCash", wallet_name="Jessa B.", wallet_number="0917 123 4821",
        auto_release_gateway=True, hold_minutes=15, pay_window_hours=24))
    for code, name, price, sizes, stock, kw, tone in CATALOG:
        await db.execute(insert(catalog_items).values(
            id=db.new_id(), seller_id=sid, code=code, name=name, price_centavos=price * 100,
            sizes=sizes, stock=stock, keywords=kw, tone=tone))
