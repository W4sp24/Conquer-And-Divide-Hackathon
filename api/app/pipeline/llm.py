"""Step 3 of the cascade: an LLM (through OpenRouter) reads only what rules and RapidFuzz could not.

Privacy: the model gets the comment text, item codes/names and the buyer's recent item
codes. Never the buyer's name or platform id. Its answer is validated with Pydantic and an
invented item code is rejected, so a bad answer can only ever send the comment to review.
"""
import json
import re
import time
from typing import Literal

import httpx
from pydantic import BaseModel, ValidationError, field_validator

from app.config import settings


class Parse(BaseModel):
    intent: Literal["claim", "cancel", "waitlist", "question", "other"]
    item_code: str | None = None
    size: str | None = None
    qty: int = 1
    for_name: str | None = None
    confidence: float

    @field_validator("qty")
    @classmethod
    def _qty(cls, v):
        return max(1, min(int(v or 1), 20))

    @field_validator("confidence")
    @classmethod
    def _conf(cls, v):
        return max(0.0, min(float(v), 1.0))


SYSTEM = (
    "You read comments from a Filipino Facebook Live selling session (ukay/fashion). "
    "Comments are in English, Tagalog or Taglish. Decide what the commenter wants.\n"
    "intent: claim (wants to buy: mine, pa-mine, akin, kuha, pabili, g, sakin), "
    "cancel (backing out of an item), waitlist (wants to be next in line), "
    "question (asking price/size/details), other (chat, greetings, compliments).\n"
    "'yung nasa camera', 'ito', 'this one', a bare 'mine' = the item on camera.\n"
    "'para kay Ana' / 'for my sister' -> for_name.\n"
    "Only use item codes from item_on_camera, recently_shown or candidates. "
    "If unsure which item, set item_code null and lower the confidence.\n"
    'Reply with JSON only: {"intent", "item_code", "size", "qty", "for_name", "confidence"}.'
)

LAST_STATUS: dict = {"ok": None, "error": None, "latency_ms": None, "at": None}


def llm_enabled() -> bool:
    return bool(settings.openrouter_api_key)


def _extract_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    m = re.search(r"\{.*\}", text, re.S)
    return m.group(0) if m else text


async def llm_parse(message: str, ctx: dict) -> Parse | None:
    if not llm_enabled():
        return None
    user = {
        "comment": message,
        "item_on_camera": ctx.get("on_camera"),          # {code, name, sizes}
        "recently_shown": ctx.get("recent_items", []),   # last 5 items shown
        "candidates": ctx.get("candidates", []),         # top 10 from RapidFuzz
        "buyer_recent_claims": ctx.get("buyer_claims", []),  # item codes only, no names
        "examples": ctx.get("examples", []),             # seller corrections (few-shot)
    }
    body = {
        "model": settings.openrouter_model,
        "temperature": 0,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": json.dumps(user, ensure_ascii=False)}],
    }
    headers = {"Authorization": f"Bearer {settings.openrouter_api_key}",
               "X-Title": "Live Seller Order Desk"}
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            r = await client.post("https://openrouter.ai/api/v1/chat/completions",
                                  headers=headers, json=body)
            r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        p = Parse.model_validate_json(_extract_json(content))
        LAST_STATUS.update(ok=True, error=None, latency_ms=int((time.perf_counter() - t0) * 1000),
                           at=time.time())
    except (httpx.HTTPError, ValidationError, KeyError, IndexError, ValueError, TypeError) as e:
        LAST_STATUS.update(ok=False, error=type(e).__name__ + ": " + str(e)[:160], at=time.time())
        return None                                      # caller sends it to review
    allowed = {c["code"] for c in ctx.get("candidates", [])}
    allowed |= {c["code"] for c in ctx.get("recent_items", [])}
    if ctx.get("on_camera"):
        allowed.add(ctx["on_camera"]["code"])
    if p.item_code:
        p.item_code = p.item_code.upper().replace(" ", "").replace("-", "")
        if p.item_code not in allowed:
            return None                                  # never trust an invented code
    return p
