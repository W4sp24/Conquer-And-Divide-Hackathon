"""Seller routes for live sessions, the live board and its SSE stream."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import insert, select, update

from app import db, rtc, views
from app.auth import seller_only
from app.hub import hub, sse_events
from app.pipeline.cascade import dismiss_comment, fix_comment
from app.schema import buyers, comments, live_sessions
from app.sessions import set_on_camera
from app.sources import runner
from app.sources.meta_live import live_videos
from app.sources.replay import list_recordings

router = APIRouter(tags=["sessions"])


class NewSession(BaseModel):
    title: str = Field("Live selling", max_length=80)
    source: str = Field("chat", pattern="^(meta|replay|chat)$")
    live_video_id: str | None = None       # Meta live video id, or a recording name for replay
    fb_video_url: str | None = None
    replay_speed: float = Field(1.0, ge=0.25, le=8)
    start: bool = True


async def _session(sid: str, seller: dict) -> dict:
    s = await db.get_session(sid)
    if not s or s["seller_id"] != seller["id"]:
        raise HTTPException(404, "session not found")
    return s


@router.get("/sessions")
async def list_sessions(seller=Depends(seller_only)):
    rows = await db.fetch(select(live_sessions).where(live_sessions.c.seller_id == seller["id"])
                          .order_by(live_sessions.c.created_at.desc()))
    out = []
    for s in rows:
        score = await views.scoreboard(s["id"])
        out.append({**views.session_view(s, s["id"] in runner.RUNNING), "comments": score["total"]})
    return out


@router.post("/sessions")
async def create_session(body: NewSession, seller=Depends(seller_only)):
    if body.source == "meta" and not body.live_video_id:
        raise HTTPException(422, "paste the live video id from Facebook")
    if body.source == "replay":
        names = {r["name"] for r in list_recordings()}
        if body.live_video_id not in names:
            raise HTTPException(422, f"pick a recording: {', '.join(sorted(names))}")
    # one live at a time: end any other running session
    for other in await db.fetch(select(live_sessions.c.id).where(
            live_sessions.c.seller_id == seller["id"], live_sessions.c.status == "running")):
        runner.stop(other["id"])
        await runner.set_status(other["id"], status="ended", ended_at=db.now())
    sid = db.new_id()
    await db.execute(insert(live_sessions).values(
        id=sid, seller_id=seller["id"], title=body.title.strip() or "Live selling", source=body.source,
        live_video_id=body.live_video_id, fb_video_url=body.fb_video_url, replay_speed=body.replay_speed))
    if body.start:
        await _start(sid)
    return views.session_view(await db.get_session(sid))


async def _start(sid: str):
    await runner.set_status(sid, status="running", error=None, started_at=db.now(), ended_at=None)
    runner.start(await db.get_session(sid))


@router.get("/sessions/{sid}")
async def get_session(sid: str, seller=Depends(seller_only)):
    return views.session_view(await _session(sid, seller), sid in runner.RUNNING)


@router.post("/sessions/{sid}/start")
async def start_session(sid: str, seller=Depends(seller_only)):
    await _session(sid, seller)
    runner.stop(sid)
    await _start(sid)
    return views.session_view(await db.get_session(sid), sid in runner.RUNNING)


@router.post("/sessions/{sid}/stop")
async def stop_session(sid: str, seller=Depends(seller_only)):
    await _session(sid, seller)
    runner.stop(sid)
    rtc.set_live(sid, False)
    await runner.set_status(sid, status="ended", ended_at=db.now())
    return views.session_view(await db.get_session(sid))


class OnCamera(BaseModel):
    item_code: str | None = None


@router.put("/sessions/{sid}/on-camera")
async def on_camera(sid: str, body: OnCamera, seller=Depends(seller_only)):
    await _session(sid, seller)
    item = await set_on_camera(sid, body.item_code)
    if body.item_code and not item:
        raise HTTPException(404, "no item with that code")
    return {"ok": True}


@router.get("/sessions/{sid}/board")
async def board(sid: str, seller=Depends(seller_only)):
    await _session(sid, seller)
    return await views.board(sid)


@router.get("/sessions/{sid}/stream")
async def stream(sid: str, request: Request, seller=Depends(seller_only)):
    await _session(sid, seller)
    return StreamingResponse(sse_events(request, f"session:{sid}", {"type": "hello"}),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/sessions/{sid}/export")
async def export(sid: str, seller=Depends(seller_only)):
    """Download the session's comments as JSON lines, ready to save in api/recordings/."""
    s = await _session(sid, seller)
    rows = await db.fetch(select(comments, buyers.c.display_name, buyers.c.platform_user_id)
                          .join(buyers, buyers.c.id == comments.c.buyer_id, isouter=True)
                          .where(comments.c.session_id == sid).order_by(comments.c.created_time))
    lines = [json.dumps({"id": r["id"].split(":")[-1], "user_id": r["platform_user_id"],
                         "name": r["display_name"], "message": r["message"],
                         "created_time": r["created_time"].isoformat()}, ensure_ascii=False) for r in rows]
    fname = f"session-{s['created_at']:%Y%m%d-%H%M}.jsonl"
    return PlainTextResponse("\n".join(lines) + "\n", media_type="application/x-ndjson",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


class TestComment(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    message: str = Field(..., min_length=1, max_length=300)


@router.post("/sessions/{sid}/comments")
async def seller_test_comment(sid: str, body: TestComment, seller=Depends(seller_only)):
    """Type a comment as if a viewer posted it (handy to rehearse without a live)."""
    s = await _session(sid, seller)
    if s["status"] != "running":
        raise HTTPException(409, "start the live first")
    cid = "test:" + db.new_id()
    task = await runner.ingest(sid, {"id": cid, "user_id": "test:" + body.name.strip().lower(),
                                     "name": body.name.strip(), "message": body.message,
                                     "created_time": db.now(), "source": "test"})
    return {"ok": True, "id": cid, "parsed": await task}


class Fix(BaseModel):
    intent: str = Field(..., pattern="^(claim|cancel|waitlist|question|other)$")
    item_code: str | None = None
    size: str | None = None
    qty: int = Field(1, ge=1, le=20)
    for_name: str | None = None


@router.post("/comments/{cid}/fix")
async def fix(cid: str, body: Fix, seller=Depends(seller_only)):
    if body.intent in ("claim", "waitlist") and not body.item_code:
        raise HTTPException(422, "pick the item")
    try:
        return await fix_comment(cid, body.model_dump(), seller["id"])
    except LookupError:
        raise HTTPException(404, "comment not found")


@router.post("/comments/{cid}/dismiss")
async def dismiss(cid: str, seller=Depends(seller_only)):
    try:
        await dismiss_comment(cid)
    except LookupError:
        raise HTTPException(404, "comment not found")
    return {"ok": True}


# ---- WebRTC: the seller side of the in-app live video -------------------------------

class RtcState(BaseModel):
    live: bool


@router.post("/sessions/{sid}/rtc/state")
async def rtc_state(sid: str, body: RtcState, seller=Depends(seller_only)):
    await _session(sid, seller)
    rtc.set_live(sid, body.live)
    await hub.publish(f"viewer:{sid}", {"type": "camera_live", "live": body.live})
    return rtc.rtc_state(sid)


class RtcAnswer(BaseModel):
    peer_id: str = Field(..., max_length=64)
    sdp: str = Field(..., max_length=100_000)


@router.post("/sessions/{sid}/rtc/answer")
async def rtc_answer(sid: str, body: RtcAnswer, seller=Depends(seller_only)):
    await _session(sid, seller)
    rtc.put_answer(body.peer_id, body.sdp)
    return {"ok": True}


# ---- helpers for the Go live screen ----------------------------------------------

@router.get("/recordings")
async def recordings(seller=Depends(seller_only)):
    return list_recordings()


@router.get("/meta/live-videos")
async def meta_live_videos(page_id: str, seller=Depends(seller_only)):
    try:
        return await live_videos(page_id)
    except Exception as e:
        raise HTTPException(502, f"Meta: {e}")


@router.post("/sessions/{sid}/rename")
async def rename(sid: str, body: dict, seller=Depends(seller_only)):
    await _session(sid, seller)
    title = str(body.get("title", "")).strip()[:80]
    if not title:
        raise HTTPException(422, "give the live a name")
    await db.execute(update(live_sessions).where(live_sessions.c.id == sid).values(title=title))
    return {"ok": True}
