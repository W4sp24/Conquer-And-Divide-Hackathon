"""Step 2 of the cascade: RapidFuzz match of the comment against item names and keywords.
Handles typos and descriptions: "mine blu polo" -> B7 Blue polo. About a millisecond."""
import re

from rapidfuzz import fuzz, process, utils

from app.pipeline.rules import CANCEL, CLAIM, FILLER, QTY, SIZE, WAITLIST


def build_choices(catalog: list[dict]) -> dict[str, str]:
    """Every name and keyword points to its item code."""
    choices: dict[str, str] = {}
    for it in catalog:
        choices[it["name"].lower()] = it["code"]
        for kw in it.get("keywords") or []:
            if len(kw) >= 3:
                choices[kw.lower()] = it["code"]
    return choices


def clean_for_match(text: str) -> str:
    """Drop order words, sizes, quantities and filler so only the description is matched."""
    low = text.lower()
    for rx in (CLAIM, WAITLIST, CANCEL, QTY, SIZE):
        low = rx.sub(" ", low)
    words = [w for w in re.sub(r"[^a-z0-9 ]", " ", low).split() if w not in FILLER]
    return " ".join(words)


def fuzzy_match(text: str, choices: dict[str, str], limit: int = 10) -> list[tuple[str, float]]:
    """Best score per item code, highest first: [(code, score), ...]."""
    query = clean_for_match(text)
    if len(query) < 3 or not choices:
        return []
    hits = process.extract(query, list(choices), scorer=fuzz.WRatio,
                           processor=utils.default_process, limit=limit * 3)
    best: dict[str, float] = {}
    for choice, score, _ in hits:
        # whole-word bonus: every word of a multi-word name present ("blue polo")
        words = choice.split()
        if len(words) > 1 and all(w in query.split() for w in words):
            score = max(score, 95)
        code = choices[choice]
        best[code] = max(best.get(code, 0), float(score))
    return sorted(best.items(), key=lambda kv: -kv[1])[:limit]
