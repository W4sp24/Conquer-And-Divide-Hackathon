"""Live session actions shared by routes and the replay runner."""
from sqlalchemy import update

from app import db
from app.hub import hub
from app.schema import live_sessions


async def set_on_camera(session_id: str, item_code: str | None) -> dict | None:
    """Put an item on camera. Bare claims ("mine po", "m") go to this item."""
    s = await db.get_session(session_id)
    if not s:
        return None
    item = await db.item_by_code(s["seller_id"], item_code) if item_code else None
    recent = [i for i in (s["recent_item_ids"] or []) if i != (item or {}).get("id")]
    if item:
        recent.append(item["id"])
    await db.execute(update(live_sessions).where(live_sessions.c.id == session_id).values(
        current_item_id=item["id"] if item else None, recent_item_ids=recent[-10:]))
    ev = {"type": "camera", "item": ({"id": item["id"], "code": item["code"], "name": item["name"],
                                       "price_centavos": item["price_centavos"], "sizes": item["sizes"],
                                       "photo_url": item["photo_url"], "tone": item["tone"],
                                       "stock": item["stock"]} if item else None)}
    await hub.publish(f"session:{session_id}", ev)
    await hub.publish(f"viewer:{session_id}", ev)
    return item
