"""Taglish benchmark: how much does each step of the cascade add?

Runs bench/comments.csv through four setups and prints one row each:
  rules only | + RapidFuzz | + LLM | + LLM with seller corrections as examples
A comment is right when intent and item both match the label. "Wrong order" counts
comments that would have created/cancelled an order for the wrong item: the worst case.

    cd api && .venv/Scripts/python -m bench.run_bench          (LLM rows need OPENROUTER_API_KEY)
"""
import asyncio
import csv
import random
import time
from pathlib import Path

from app.pipeline import cascade
from app.pipeline.llm import llm_enabled, llm_parse
from app.pipeline.rules import parse_rules
from app.seed import CATALOG

HERE = Path(__file__).parent
ITEMS = [{"id": c, "code": c, "name": n, "price_centavos": p * 100, "sizes": s, "stock": st, "keywords": kw}
         for c, n, p, s, st, kw, _ in CATALOG]
BY_CODE = {i["code"]: i for i in ITEMS}
ORDER_INTENTS = {"claim", "cancel", "waitlist"}


def load():
    with open(HERE / "comments.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def brief(i):
    return {"code": i["code"], "name": i["name"], "sizes": i["sizes"]}


async def run_setup(rows, setup: str, examples=None):
    right = review = wrong = 0
    t0 = time.perf_counter()
    for r in rows:
        cam = BY_CODE.get(r["on_camera"])
        if setup == "rules":
            res = parse_rules(r["message"], set(BY_CODE), cam["code"] if cam else None)
            stage = "ignored" if res is None else ("review" if res["confidence"] < cascade.REVIEW_BELOW else "rules")
        else:
            use_llm = setup in ("llm", "examples")

            async def ctx_fn(hits):
                return {"on_camera": brief(cam) if cam else None, "recent_items": [],
                        "candidates": [brief(BY_CODE[c]) for c, _ in hits],
                        "buyer_claims": [], "examples": examples or []}

            async def no_llm(msg, ctx):
                return None
            stage, res, _ = await cascade.classify(r["message"], ITEMS, cam, ctx_fn,
                                                   llm=llm_parse if use_llm else no_llm)
            if not use_llm and stage == "llm":
                stage = "review"
        gold_intent = r["gold_intent"]
        gold_item = r["gold_item"] or None
        if stage == "review":
            review += 1
            continue
        got_intent = (res or {}).get("intent") if stage != "ignored" else "other"
        got_item = (res or {}).get("item_code") if stage != "ignored" else None
        if gold_intent in ("question", "other"):
            ok = got_intent in ("question", "other")
        else:
            ok = got_intent == gold_intent and (got_item or None) == gold_item
        if ok:
            right += 1
        elif got_intent in ORDER_INTENTS and got_item:
            wrong += 1
    n = len(rows)
    ms = (time.perf_counter() - t0) * 1000 / max(n, 1)
    return {"right": 100 * right / n, "review": 100 * review / n, "wrong": 100 * wrong / n, "ms": ms}


async def main():
    rows = load()
    setups = [("Rules only", "rules"), ("+ RapidFuzz", "fuzzy")]
    if llm_enabled():
        setups.append(("+ LLM", "llm"))
    print(f"{len(rows)} labeled comments\n")
    print(f"{'Setup':<16}{'Right %':>9}{'Review %':>10}{'Wrong order %':>15}{'ms/comment':>12}")
    for label, key in setups:
        m = await run_setup(rows, key)
        print(f"{label:<16}{m['right']:>9.1f}{m['review']:>10.1f}{m['wrong']:>15.1f}{m['ms']:>12.1f}")
    if llm_enabled():
        random.seed(7)
        shuffled = rows[:]
        random.shuffle(shuffled)
        k = min(30, len(rows) // 3)
        ex_rows, test_rows = shuffled[:k], shuffled[k:]       # never grade the examples it learned from
        examples = [{"comment": r["message"], "answer": {"intent": r["gold_intent"], "item_code": r["gold_item"] or None,
                                                          "size": r["gold_size"] or None, "qty": int(r["gold_qty"] or 1)}}
                    for r in ex_rows]
        m = await run_setup(test_rows, "examples", examples)
        print(f"{'+ corrections':<16}{m['right']:>9.1f}{m['review']:>10.1f}{m['wrong']:>15.1f}{m['ms']:>12.1f}")
    else:
        print("\n(set OPENROUTER_API_KEY in api/.env to add the + LLM and + corrections rows)")


if __name__ == "__main__":
    asyncio.run(main())
