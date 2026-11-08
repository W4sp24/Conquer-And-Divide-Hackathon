"""LLM step against a faked OpenRouter: odd but valid answers are kept, empty ones go to review."""
import asyncio
import json

import httpx
import pytest

from app.config import settings
from app.pipeline import llm

CTX = {"on_camera": {"code": "B7", "name": "Blue dress", "sizes": ["S", "M"]}, "candidates": []}


@pytest.fixture
def reply(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test")
    real = httpx.AsyncClient

    def use(content):
        def handler(request):
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})
        monkeypatch.setattr(llm.httpx, "AsyncClient",
                            lambda **kw: real(transport=httpx.MockTransport(handler)))
    return use


def test_null_qty_is_accepted(reply):
    reply(json.dumps({"intent": "claim", "item_code": "B7", "size": None, "qty": None,
                      "for_name": None, "confidence": 0.9}))
    p = asyncio.run(llm.llm_parse("mine yung nasa camera", CTX))
    assert p and p.item_code == "B7" and p.qty == 1


def test_empty_reply_goes_to_review(reply):
    reply(None)
    assert asyncio.run(llm.llm_parse("mine po", CTX)) is None
    assert llm.LAST_STATUS["ok"] is False


def test_invented_code_is_rejected(reply):
    reply(json.dumps({"intent": "claim", "item_code": "B99", "qty": 1, "confidence": 0.95}))
    assert asyncio.run(llm.llm_parse("mine B99", CTX)) is None
