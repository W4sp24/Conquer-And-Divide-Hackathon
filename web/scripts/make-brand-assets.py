"""Builds the web app's logo files from the original brand image (docs/assets/logo.png).

The original is an opaque 480x480 image on a near-white background. This lifts the
background off (so the logo sits cleanly on any light surface) and writes:
  web/public/logo.png          full logo, transparent, trimmed
  web/public/logo-mark.png     the "M" mark with the LIVE pill, transparent, trimmed
  web/public/favicon-32.png    browser tab icon
  web/public/icon-192.png, icon-512.png   home-screen / PWA icons
  web/public/apple-touch-icon.png  iOS home-screen icon (opaque, as iOS requires)

  docs/assets/logo-banner.png  trimmed logo on white, for the README

Run from the repo root:  python web/scripts/make-brand-assets.py   (needs Pillow + numpy)
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "assets" / "logo.png"
OUT = ROOT / "web" / "public"

# Brand colours sampled from the logo, used to separate "ink" from the white backdrop.
INKS = [(0x00, 0x2E, 0x37), (0x0A, 0x5C, 0x5B), (0x6D, 0xBF, 0x9F), (0xB0, 0xE8, 0xD8)]


def flood(light: np.ndarray) -> np.ndarray:
    """Pixels of the `light` mask that connect to the top-left corner (4-connected)."""
    h, w = light.shape
    seen = np.zeros_like(light, dtype=bool)
    stack = [(0, 0)]
    while stack:
        y, x = stack.pop()
        if 0 <= y < h and 0 <= x < w and light[y, x] and not seen[y, x]:
            seen[y, x] = True
            stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    return seen


def lift_background(im: Image.Image) -> Image.Image:
    rgb = np.asarray(im.convert("RGB")).astype(float)
    h, w, _ = rgb.shape

    # The backdrop is whatever light area touches the outside edge. Light areas enclosed by
    # the logo (the white "LIVE" lettering) are part of the artwork and stay opaque.
    outside = flood(rgb.min(axis=2) >= 150)

    alpha = np.ones((h, w))
    out = rgb.copy()
    best_res = np.full((h, w), np.inf)
    for ink in INKS:
        d = 255 - np.array(ink, float)                     # backdrop -> ink direction
        v = 255 - rgb
        t = np.clip((v @ d) / (d @ d), 0, 1)               # how much ink covers the pixel
        res = np.linalg.norm(255 - t[..., None] * d - rgb, axis=2)
        better = outside & (res < best_res)
        best_res = np.where(better, res, best_res)
        alpha = np.where(better, t, alpha)
    alpha = np.where(outside & (alpha > 0.96), 1.0, alpha)  # solid ink keeps its own pixel colour
    alpha = np.where(outside & (alpha < 0.04), 0.0, alpha)
    a3 = np.maximum(alpha, 1e-6)[..., None]
    out = np.where(outside[..., None], np.clip((rgb - 255 * (1 - a3)) / a3, 0, 255), rgb)
    return Image.fromarray(np.dstack([out, alpha * 255]).astype("uint8"), "RGBA")


def components(mask: np.ndarray) -> np.ndarray:
    """Label 4-connected regions of `mask` (0 = background)."""
    h, w = mask.shape
    labels = np.zeros((h, w), int)
    n = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if labels[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]
        while stack:
            y, x = stack.pop()
            if 0 <= y < h and 0 <= x < w and mask[y, x] and not labels[y, x]:
                labels[y, x] = n
                stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    return labels


def m_glyph(mark: Image.Image) -> Image.Image:
    """The big "M" shape (with the play triangle inside), without the rays or the LIVE pill."""
    alpha = np.asarray(mark.getchannel("A")) > 20
    labels = components(alpha)
    sizes = np.bincount(labels.ravel())[1:]
    big = int(np.argmax(sizes)) + 1
    ys, xs = np.nonzero(labels == big)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    keep = labels == big
    for k in range(1, labels.max() + 1):             # small pieces wholly inside the M's box, e.g. the triangle
        if k == big or sizes[k - 1] < 150:
            continue
        ky, kx = np.nonzero(labels == k)
        if ky.min() >= y0 and ky.max() <= y1 and kx.min() >= x0 and kx.max() <= x1:
            keep |= labels == k
    out = np.asarray(mark).copy()
    out[~keep, 3] = 0
    return Image.fromarray(out, "RGBA").crop((x0, y0, x1 + 1, y1 + 1))


def trim(im: Image.Image, pad: int) -> Image.Image:
    box = im.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
    c = im.crop(box)
    canvas = Image.new("RGBA", (c.width + 2 * pad, c.height + 2 * pad), (0, 0, 0, 0))
    canvas.paste(c, (pad, pad))
    return canvas


def square(im: Image.Image, size: int, fill=(0, 0, 0, 0), margin=0.12) -> Image.Image:
    inner = int(size * (1 - 2 * margin))
    s = min(inner / im.width, inner / im.height)
    r = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), fill)
    canvas.alpha_composite(r, ((size - r.width) // 2, (size - r.height) // 2))
    return canvas


def main() -> None:
    full = lift_background(Image.open(SRC))
    OUT.mkdir(parents=True, exist_ok=True)

    full_trim = trim(full, 0)
    trim(full, 6).save(OUT / "logo.png", optimize=True)

    # The mark sits above the wordmark; a clear gap of rows separates them.
    a = np.asarray(full.getchannel("A")) > 20
    rows = np.where(a.any(axis=1))[0]
    gap = next(i for i in range(len(rows) - 1) if rows[i + 1] - rows[i] > 6)
    mark = full.crop((0, 0, full.width, rows[gap] + 1))
    trim(mark, 4).save(OUT / "logo-mark.png", optimize=True)

    # Icons use only the "M" itself: the rays and LIVE pill turn to mush at 32px.
    glyph = m_glyph(mark)
    square(glyph, 32).save(OUT / "favicon-32.png", optimize=True)
    square(glyph, 192, margin=0.16).save(OUT / "icon-192.png", optimize=True)
    square(glyph, 512, margin=0.16).save(OUT / "icon-512.png", optimize=True)
    square(glyph, 180, fill=(255, 255, 255, 255), margin=0.2).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    banner = Image.new("RGBA", (full_trim.width + 48, full_trim.height + 48), (255, 255, 255, 255))
    banner.alpha_composite(full_trim, (24, 24))
    banner.convert("RGB").save(SRC.with_name("logo-banner.png"), optimize=True)
    print("ok", "logo", trim(full, 6).size, "mark", trim(mark, 4).size, "M glyph", glyph.size)


if __name__ == "__main__":
    main()
