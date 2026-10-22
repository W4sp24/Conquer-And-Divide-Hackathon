"""In-memory SSE fan-out.

Keys used:
  session:{id}  seller board for one live session (comments, parses, orders, verdicts, WebRTC offers)
  seller:{id}   seller-wide events (Payments and Packing screens)
  viewer:{id}   public viewer page of a session (masked comments, on-camera item, stream status)
  order:{token} one buyer's order page
Fine for one backend instance; use Supabase Realtime or Redis to run several.
"""
import asyncio
import json
from collections import defaultdict


class Hub:
    def __init__(self):
        self.subs: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, key: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self.subs[key].add(q)
        return q

    def unsubscribe(self, key: str, q: asyncio.Queue):
        self.subs[key].discard(q)
        if not self.subs[key]:
            self.subs.pop(key, None)

    def count(self, key: str) -> int:
        return len(self.subs.get(key, ()))

    async def publish(self, key: str, event: dict):
        for q in list(self.subs.get(key, ())):
            if not q.full():            # a frozen tab must never slow the live
                q.put_nowait(event)


hub = Hub()


def sse_format(event: dict) -> str:
    return f"data: {json.dumps(event, default=str, ensure_ascii=False)}\n\n"


async def sse_events(request, key: str, first: dict | None = None):
    """Async generator used by every SSE route."""
    q = hub.subscribe(key)
    try:
        yield "retry: 3000\n\n"
        if first:
            yield sse_format(first)
        while not await request.is_disconnected():
            try:
                ev = await asyncio.wait_for(q.get(), timeout=15)
                yield sse_format(ev)
            except asyncio.TimeoutError:
                yield ": ping\n\n"      # keeps proxies from closing the stream
    finally:
        hub.unsubscribe(key, q)
