"""Replays a saved session with the same gaps between comments (demo fallback if the live
or the venue Wi-Fi fails). Rows are JSON lines:
  {"id", "user_id", "name", "message", "created_time"}       a comment
  {"type": "camera", "item_code": "B12", "created_time"}       seller puts an item on camera
"""
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

RECORDINGS = Path(__file__).resolve().parent.parent.parent / "recordings"


def _t(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00").replace("+0000", "+00:00"))


def list_recordings() -> list[dict]:
    out = []
    for p in sorted(RECORDINGS.glob("*.jsonl")):
        lines = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
        comments = [x for x in lines if x.get("type", "comment") == "comment"]
        span = 0.0
        if len(lines) > 1:
            span = (_t(lines[-1]["created_time"]) - _t(lines[0]["created_time"])).total_seconds()
        out.append({"name": p.stem, "comments": len(comments), "seconds": round(span)})
    return out


async def replay_comments(recording: str, session_id: str, speed: float = 1.0):
    """Play a saved session back. Comment times are replaced with 'now' so the queue order
    follows the replay, exactly like a real live."""
    path = (RECORDINGS / f"{recording}.jsonl").resolve()
    if path.parent != RECORDINGS.resolve() or not path.exists():
        raise FileNotFoundError(f"recording {recording!r} not found")
    rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]
    prev = None
    run = format(int(time.time() * 1000) % 10**9, "x")   # new ids per run, so a file can play twice
    for row in rows:
        t = _t(row["created_time"])
        if prev:
            await asyncio.sleep(max(0.0, (t - prev).total_seconds()) / max(speed, 0.1))
        prev = t
        yield {**row,
               "id": f"{session_id}:{run}:{row.get('id', id(row))}",
               "source": "replay",
               "created_time": datetime.now(timezone.utc)}
