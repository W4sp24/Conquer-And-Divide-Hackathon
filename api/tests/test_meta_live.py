"""Meta live_comments reader: reconnects, skips resends, stops on fatal errors. No network."""
import asyncio
import json

import httpx
import pytest

from app.config import settings
from app.sources import meta_live


def _line(i):
    return "data: " + json.dumps({"id": f"c{i}", "message": f"mine B{i}",
                                  "created_time": "2026-11-08T10:00:00+0000",
                                  "from": {"id": f"u{i}", "name": f"Buyer {i}"}})


@pytest.fixture
def fake_meta(monkeypatch):
    monkeypatch.setattr(settings, "meta_page_token", "tok")
    sleeps = []

    async def no_sleep(s):
        sleeps.append(s)
    monkeypatch.setattr(meta_live, "_sleep", no_sleep)

    def use(responses):
        calls = iter(responses)

        def handler(request):
            status, lines = next(calls)
            return httpx.Response(status, text="\n".join(lines))
        monkeypatch.setattr(meta_live, "_client",
                            lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return use, sleeps


async def _take(n):
    out = []
    async for c in meta_live.meta_comments("vid"):
        out.append(c["id"])
        if len(out) == n:
            break
    return out


def test_reconnects_and_skips_resent_comments(fake_meta):
    use, sleeps = fake_meta
    use([(200, [": ping", _line(1), _line(2)]),      # stream closes after two comments
         (503, ["busy"]),                              # one failed reconnect
         (200, [_line(2), _line(3)])])                 # Meta resends c2
    assert asyncio.run(_take(3)) == ["c1", "c2", "c3"]
    assert sleeps == [1, 2]


def test_bad_token_stops_at_once(fake_meta):
    use, sleeps = fake_meta
    use([(400, ['{"error":{"message":"Invalid OAuth access token"}}'])] * 2)   # stream, then poll
    with pytest.raises(meta_live.MetaFatal, match="Invalid OAuth"):
        asyncio.run(_take(1))
    assert sleeps == []


def test_gives_up_after_repeated_failures(fake_meta):
    use, sleeps = fake_meta
    use([(500, ["down"])] * (meta_live.MAX_FAILURES + 1))
    with pytest.raises(RuntimeError, match="Lost the Facebook comment stream"):
        asyncio.run(_take(1))
    assert len(sleeps) == meta_live.MAX_FAILURES


def test_html_error_page_becomes_a_readable_message(fake_meta):
    use, _ = fake_meta
    use([(400, ["<!DOCTYPE html><html><head><title>Error</title></head></html>"]),
         (400, ['{"error":{"message":"Missing permissions"}}'])])
    with pytest.raises(meta_live.MetaFatal, match="could not open this live video"):
        asyncio.run(_take(1))


def _poll(*ids):
    return (200, [json.dumps({"data": [json.loads(_line(i)[6:]) for i in ids]})])


def test_profile_live_falls_back_to_polling(fake_meta):
    use, sleeps = fake_meta
    use([(400, ["<!DOCTYPE html><html></html>"]),       # stream refused (profile live)
         _poll(1),                                       # newest first
         _poll(3, 2, 1)])                                # c1 seen already
    assert asyncio.run(_take(3)) == ["c1", "c2", "c3"]
    assert sleeps == [meta_live.POLL_SECONDS]


def test_video_id_is_cleaned_up():
    from app.routers.sessions import clean_video_id
    assert clean_video_id("1459971419396458.") == "1459971419396458"
    assert clean_video_id("  1459971419396458 ") == "1459971419396458"
    assert clean_video_id("https://www.facebook.com/4595142020758714/videos/1459971419396458/") == "1459971419396458"
    assert clean_video_id("https://www.facebook.com/watch/?v=1459971419396458") == "1459971419396458"
    assert clean_video_id("hello") is None
