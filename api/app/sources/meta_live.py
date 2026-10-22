"""Reads Meta's live_comments stream (Live Video API, read-only, Page access token).

The Page token stays on the backend: the browser never sees it.
"""
import json

import httpx

from app.config import settings

STREAM = "https://streaming-graph.facebook.com/{vid}/live_comments"
GRAPH = "https://graph.facebook.com/{ver}/{path}"


async def meta_comments(live_video_id: str):
    """Yield every new comment on a Facebook live video."""
    if not settings.meta_page_token:
        raise RuntimeError("META_PAGE_TOKEN is not set on the backend")
    params = {
        "access_token": settings.meta_page_token,
        "fields": "from{name,id},message,created_time",
        "comment_rate": "ten_per_second",
    }
    url = STREAM.format(vid=live_video_id)
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("GET", url, params=params) as r:
            if r.status_code >= 400:
                body = (await r.aread()).decode(errors="replace")[:300]
                raise RuntimeError(f"Meta returned {r.status_code}: {body}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue                    # skips ": ping" keep-alives
                try:
                    c = json.loads(line[5:])
                except json.JSONDecodeError:
                    continue
                sender = c.get("from") or {}    # may be missing for viewers without app roles
                yield {
                    "id": c["id"],
                    "user_id": sender.get("id") or f"anon:{c['id']}",
                    "name": sender.get("name", "Facebook viewer"),
                    "message": c.get("message", ""),
                    "created_time": c["created_time"],
                    "source": "meta",
                }


async def live_videos(page_id: str) -> list[dict]:
    """GET /{page-id}/live_videos: find the running live's id."""
    if not settings.meta_page_token:
        raise RuntimeError("META_PAGE_TOKEN is not set on the backend")
    url = GRAPH.format(ver=settings.meta_graph_version, path=f"{page_id}/live_videos")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, params={"access_token": settings.meta_page_token,
                                          "fields": "id,status,title,permalink_url,creation_time"})
        r.raise_for_status()
        return r.json().get("data", [])
