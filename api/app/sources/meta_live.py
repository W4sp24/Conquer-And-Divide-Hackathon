"""Reads Meta's live_comments stream (Live Video API, read-only, Page access token).

The Page token stays on the backend: the browser never sees it.
"""
import asyncio
import json
import logging

import httpx

from app.config import settings

STREAM = "https://streaming-graph.facebook.com/{vid}/live_comments"
GRAPH = "https://graph.facebook.com/{ver}/{path}"
MAX_FAILURES = 6          # consecutive failed reconnects before the board shows an error
POLL_SECONDS = 2          # fallback: how often to read /{video}/comments
log = logging.getLogger("meta_live")


class MetaFatal(RuntimeError):
    """A problem reconnecting cannot fix (bad token, wrong video id, missing permission)."""


def _client() -> httpx.AsyncClient:       # replaced in tests
    return httpx.AsyncClient(timeout=httpx.Timeout(10, read=90))


async def _sleep(seconds: float):         # replaced in tests
    await asyncio.sleep(seconds)


def _parse(line: str) -> dict | None:
    if not line.startswith("data:"):
        return None                       # skips ": ping" keep-alives
    try:
        c = json.loads(line[5:])
    except json.JSONDecodeError:
        return None
    return _comment(c)


def _comment(c: dict) -> dict:
    sender = c.get("from") or {}          # may be missing for viewers without app roles
    return {
        "id": c["id"],
        "user_id": sender.get("id") or f"anon:{c['id']}",
        "name": sender.get("name", "Facebook viewer"),
        "message": c.get("message", ""),
        "created_time": c["created_time"],
        "source": "meta",
    }


async def meta_comments(live_video_id: str):
    """Yield every new comment on a Facebook live video. Meta closes the stream now and
    then, so reconnect with backoff and only give up after repeated failures. If Meta
    refuses the stream outright (it does for lives on a personal profile), read the
    video's comments edge every POLL_SECONDS instead."""
    if not settings.meta_page_token:
        raise MetaFatal("META_PAGE_TOKEN is not set on the backend")
    params = {
        "access_token": settings.meta_page_token,
        "fields": "from{name,id},message,created_time",
        "comment_rate": "ten_per_second",
    }
    url = STREAM.format(vid=live_video_id)
    seen: set[str] = set()
    failures = 0
    streamed = False
    while True:
        try:
            async with _client() as client:
                async with client.stream("GET", url, params=params) as r:
                    if r.status_code >= 400:
                        body = (await r.aread()).decode(errors="replace")[:300]
                        if body.lstrip().startswith("<"):   # Meta sends an HTML error page here
                            body = ("Facebook could not open this live video with the current token. "
                                    "Check the video ID, and that the token belongs to the Page or "
                                    "profile that is live.")
                        msg = f"Meta returned {r.status_code}: {body}"
                        if r.status_code in (400, 401, 403, 404):
                            raise MetaFatal(msg)
                        raise RuntimeError(msg)
                    async for line in r.aiter_lines():
                        c = _parse(line)
                        if c is None:
                            continue
                        failures, streamed = 0, True
                        if c["id"] in seen:
                            continue
                        seen.add(c["id"])
                        yield c
            reason = "stream closed"
        except MetaFatal as e:
            if streamed:
                raise
            log.warning("Meta refused the live stream (%s); polling comments instead", e)
            async for c in _poll_comments(live_video_id, seen, str(e)):
                yield c
            return
        except (httpx.HTTPError, RuntimeError) as e:
            reason = str(e)[:200] or type(e).__name__
        failures += 1
        if failures > MAX_FAILURES:
            raise RuntimeError(f"Lost the Facebook comment stream ({reason}). Is the live still on?")
        wait = min(2 ** (failures - 1), 30)
        log.warning("Meta stream ended (%s); reconnect %d/%d in %ss", reason, failures, MAX_FAILURES, wait)
        await _sleep(wait)


async def _poll_comments(live_video_id: str, seen: set[str], stream_error: str):
    """Fallback reader: GET /{video}/comments, newest first, and yield the unseen ones oldest first."""
    url = GRAPH.format(ver=settings.meta_graph_version, path=f"{live_video_id}/comments")
    params = {"access_token": settings.meta_page_token, "fields": "from{name,id},message,created_time",
              "order": "reverse_chronological", "filter": "stream", "limit": 100,
              "live_filter": "no_filter"}   # default drops "low quality" comments, e.g. a short "mine B7"
    first, failures = True, 0
    while True:
        try:
            async with _client() as client:
                r = await client.get(url, params=params)
            if r.status_code >= 400:
                try:
                    detail = r.json().get("error", {}).get("message", "")
                except ValueError:
                    detail = r.text[:200]
                msg = f"{stream_error} Reading comments also failed ({r.status_code}): {detail}"
                if first or r.status_code in (400, 401, 403, 404):
                    raise MetaFatal(msg)
                raise RuntimeError(msg)
            fresh = [_comment(c) for c in r.json().get("data", []) if c.get("id") not in seen]
            for c in reversed(fresh):
                seen.add(c["id"])
                yield c
            first, failures = False, 0
            await _sleep(POLL_SECONDS)
        except MetaFatal:
            raise
        except (httpx.HTTPError, RuntimeError, ValueError) as e:
            failures += 1
            if failures > MAX_FAILURES:
                raise RuntimeError(f"Lost the Facebook comments ({str(e)[:200]}). Is the live still on?")
            await _sleep(min(2 ** (failures - 1), 30))


async def live_videos(page_id: str) -> list[dict]:
    """GET /{page-id}/live_videos: find the running live's id."""
    if not settings.meta_page_token:
        raise RuntimeError("META_PAGE_TOKEN is not set on the backend")
    url = GRAPH.format(ver=settings.meta_graph_version, path=f"{page_id}/live_videos")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, params={"access_token": settings.meta_page_token,
                                          "fields": "id,status,title,permalink_url,creation_time"})
        if r.status_code >= 400:                    # not raise_for_status: its text has the token
            raise RuntimeError(f"{r.status_code}: {r.text[:300]}")
        return r.json().get("data", [])
