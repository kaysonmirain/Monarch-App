#!/usr/bin/env python3
"""
Build build/icon.icns: white queen on #141a17 (same look as menu / favicon tile) for macOS app + Dock.
Requires Pillow + macOS `iconutil`. Run from repo root: python3 scripts/generate-mac-app-icon.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Install Pillow: pip3 install Pillow", file=sys.stderr)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
ICONSET = os.path.join(BUILD, "Monarch.iconset")
ICNS_OUT = os.path.join(BUILD, "icon.icns")

# Match favicon / title screen dark tile
BG = (20, 26, 23, 255)  # #141a17
FG = (244, 248, 240, 255)
QUEEN = "\u2655"  # white chess queen

FONT_CANDIDATES = [
    "/System/Library/Fonts/Apple Symbols.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
]


def load_font(px: int):
    # ~70% of tile — queen fills the app icon tile (Dock / Spotlight / Finder).
    size = max(11, int(px * 0.70))
    for fp in FONT_CANDIDATES:
        if os.path.isfile(fp):
            try:
                return ImageFont.truetype(fp, size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_png(px: int, path: str) -> None:
    im = Image.new("RGBA", (px, px), BG)
    dr = ImageDraw.Draw(im)
    font = load_font(px)
    bbox = dr.textbbox((0, 0), QUEEN, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (px - tw) / 2 - bbox[0]
    y = (px - th) / 2 - bbox[1] - px * 0.028
    dr.text((x, y), QUEEN, font=font, fill=FG)
    im.save(path)


def main() -> int:
    shutil.rmtree(ICONSET, ignore_errors=True)
    os.makedirs(ICONSET, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)

    # Apple iconset naming (pixel sizes)
    specs = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for px, name in specs:
        draw_png(px, os.path.join(ICONSET, name))

    if os.path.isfile(ICNS_OUT):
        os.remove(ICNS_OUT)
    r = subprocess.run(
        ["iconutil", "-c", "icns", ICONSET, "-o", ICNS_OUT],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print(r.stderr or r.stdout, file=sys.stderr)
        return r.returncode
    print("[generate-mac-app-icon] wrote", ICNS_OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
