"""Step 1 of the cascade: plain regex rules. Instant, free and easy to explain.

Returns None when the comment has no order word at all (chat, greetings, questions),
otherwise {intent, item_code, size, qty, confidence}.
"""
import re

CLAIM = re.compile(r"\b(mine+|mina|myn|grab|kuha|kukunin|kunin|pa-?mine|pabili|bili|akin|sakin|order|reserve)\b", re.I)
WAITLIST = re.compile(r"\b(waitlist|wait ?list|backup|back-up|reserve next|next po|pa-?next)\b", re.I)
CANCEL = re.compile(r"\b(cancel+(?:ed)?|pass|di na|hindi na|ayaw ko na|ayoko na|pass po)\b", re.I)
CODE = re.compile(r"\b([a-z]{1,2})\s?-?(\d{1,3})\b", re.I)          # B12, b 12, B-12
SIZE = re.compile(r"\b(xxs|xs|xxl|xl|small|medium|large|s|l)\b", re.I)
QTY = re.compile(r"\b(\d+)\s?(?:pcs?|x)\b|\bx\s?(\d+)\b", re.I)
FILLER = {"po", "ate", "sis", "kuya", "ko", "pls", "please", "yung", "ung", "na", "ito", "to",
          "this", "one", "ni", "si", "nga", "lang", "sana", "rin", "din", "ma'am", "maam", "mam",
          "beh", "be", "pa", "nalang", "na lang", "ty", "thanks", "salamat", "huhu", "pls", "plss"}
SIZES = {"xxs": "XXS", "xs": "XS", "s": "S", "small": "S", "medium": "M", "l": "L",
         "large": "L", "xl": "XL", "xxl": "XXL"}


def find_code(low: str, codes: set[str]) -> str | None:
    for p, n in CODE.findall(low):
        code = f"{p.upper()}{int(n)}"
        if code in codes:
            return code
    return None


def parse_rules(msg: str, codes: set[str], on_camera: str | None) -> dict | None:
    low = msg.strip().lower()
    code = find_code(low, codes)
    if CANCEL.search(low):
        return {"intent": "cancel", "item_code": code, "size": None, "qty": 1,
                "confidence": 1.0 if code else 0.5}
    if re.fullmatch(r"m+[!.]*", low):                     # a lone "m" means mine
        return {"intent": "claim", "item_code": on_camera, "size": None,
                "qty": 1, "confidence": 0.9 if on_camera else 0.4}
    waitlist = bool(WAITLIST.search(low))
    if not CLAIM.search(low) and not waitlist:
        return None                                       # not an obvious order
    intent = "waitlist" if waitlist and not CLAIM.search(low) else "claim"
    size_m = SIZE.search(low)
    qty_m = QTY.search(low)
    qty = int(next(g for g in qty_m.groups() if g)) if qty_m else 1
    qty = max(1, min(qty, 20))
    if code:
        conf, item = 1.0, code
    else:
        rest = CLAIM.sub(" ", WAITLIST.sub(" ", low))
        if qty_m:
            rest = rest.replace(qty_m.group(0), " ")
        left = set(re.sub(r"[^a-z ]", " ", rest).split()) - FILLER
        if size_m:
            left.discard(size_m.group(1).lower())
        # "mine po" with no other words = the item on camera
        conf, item = (0.9, on_camera) if not left and on_camera else (0.5, None)
    return {"intent": intent, "item_code": item,
            "size": SIZES.get(size_m.group(1).lower()) if size_m else None,
            "qty": qty, "confidence": conf}


def pick_size(msg: str, item_sizes: list[str]) -> str | None:
    """Item-aware size check: finds any of the item's own sizes ("28", "Free size", "XL").
    A lone "m" is skipped on purpose because it also means "mine"."""
    low = f" {msg.lower()} "
    for s in sorted(item_sizes, key=len, reverse=True):
        sl = s.lower()
        if sl == "m":
            # "M" only counts with a hint: "medium", "size m", ", m", "m sana", "m po"
            if re.search(r"\b(medium|size m|sz m)\b", low) or re.search(r"[,/]\s*m\b|\bm\s*(?:size|sana|po)\b", low):
                return s
            continue
        if re.search(rf"(?<![a-z0-9]){re.escape(sl)}(?![a-z0-9])", low):
            return s
    mapped = SIZE.search(low)
    if mapped:
        norm = SIZES.get(mapped.group(1).lower())
        for s in item_sizes:
            if s.upper() == norm:
                return s
    return None
