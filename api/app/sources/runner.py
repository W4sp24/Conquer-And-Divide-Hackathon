"""One background task per running live session. Comments from every source (Meta,
Replay, the in-app viewer chat) end up in the same `ingest` call, so nothing after this
step knows which source is running."""
import asyncio
import logging
from datetime import datetime

from sqlalchemy import update

from app import db
from app.hub import hub
from app.pipeline.cascade import process_comment
from app.schema import live_sessions
from app.sources.meta_live import meta_comments
from app.sources.replay import replay_comments

log = logging.getLogger("runner")
RUNNING: dict[str, asyncio.Task] = {}
_parse_tasks: set[asyncio.Task] = set()


def _to_dt(v):
    if isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00").replace("+0000", "+00:00"))


async def ingest(session_id: str, c: dict):
    """Show the raw comment at once, then parse it in the background so a slow LLM call
    never stalls the stream."""
    c = {**c, "created_time": _to_dt(c["created_time"])}
    raw = {"type": "comment", "comment": {
        "id": c["id"], "name": db.mask_name(c["name"]), "message": c["message"],
        "created_time": c["created_time"].isoformat(), "source": c.get("source", "chat")}}
    await hub.publish(f"session:{session_id}", raw)
    await hub.publish(f"viewer:{session_id}", raw)
    t = asyncio.create_task(process_comment(session_id, c))
    _parse_tasks.add(t)
    t.add_done_callback(_parse_tasks.discard)
    return t


async def set_status(session_id: str, **vals):
    await db.execute(update(live_sessions).where(live_sessions.c.id == session_id).values(**vals))
    s = await db.get_session(session_id)
    ev = {"type": "session", "status": s["status"], "error": s.get("error")}
    await hub.publish(f"session:{session_id}", ev)
    await hub.publish(f"viewer:{session_id}", ev)


async def run_session(s: dict):
    from app.sessions import set_on_camera
    try:
        if s["source"] == "meta":
            src = meta_comments(s["live_video_id"])
        elif s["source"] == "replay":
            src = replay_comments(s["live_video_id"], s["id"], s.get("replay_speed") or 1.0)
        else:
            return                                  # "chat": comments arrive through the API
        async for c in src:
            if c.get("type") == "camera":
                await set_on_camera(s["id"], c.get("item_code"))
                continue
            await ingest(s["id"], c)
        if s["source"] == "replay":
            await hub.publish(f"session:{s['id']}", {"type": "replay_done"})
    except asyncio.CancelledError:
        raise
    except Exception as e:                          # show the problem on the board, keep the app up
        log.exception("source failed")
        await set_status(s["id"], error=str(e)[:300])
    finally:
        RUNNING.pop(s["id"], None)


def start(s: dict):
    if s["id"] not in RUNNING and s["source"] in ("meta", "replay"):
        RUNNING[s["id"]] = asyncio.create_task(run_session(s))


def stop(session_id: str):
    task = RUNNING.pop(session_id, None)
    if task:
        task.cancel()


async def drain():
    """Wait for in-flight parses (tests and graceful shutdown)."""
    while _parse_tasks:
        await asyncio.gather(*list(_parse_tasks), return_exceptions=True)
