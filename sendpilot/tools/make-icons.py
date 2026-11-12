#!/usr/bin/env python3
"""Erzeugt die Pairfob-Icons als PNG (16/32/48/128 px) ohne externe Abhängigkeiten.

Motiv: abgerundetes Quadrat mit Türkis-Verlauf, darin ein weißes "P".
Aufruf: python3 tools/make-icons.py
"""

import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

TEAL_TOP = (20, 184, 166)       # #14b8a6
TEAL_BOTTOM = (13, 83, 82)      # #0d5352
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_rect_alpha(x, y, size, radius):
    """Deckung eines abgerundeten Quadrats (Antialiasing über Distanz)."""
    inset = size * 0.06
    r = radius
    left, top = inset, inset
    right, bottom = size - inset, size - inset
    cx = min(max(x, left + r), right - r)
    cy = min(max(y, top + r), bottom - r)
    dist = math.hypot(x - cx, y - cy)

    inside_x = left <= x <= right
    inside_y = top <= y <= bottom
    if not (inside_x and inside_y):
        return 0.0
    return max(0.0, min(1.0, (r + 0.5 - dist) if dist > 0 else 1.0))


def letter_alpha(px, py, s, thickness):
    """Alpha-Wert ob px,py im/dicht am P-Buchstaben liegt."""
    t = thickness
    # Vertikaler Balken
    x0, x1 = s * 0.26, s * 0.26 + t
    y0, y1 = s * 0.22, s * 0.78
    # Bogen-Parameter
    x_arc = s * 0.26
    x_arc_end = s * 0.74
    arc_r = (x_arc_end - x_arc) / 2
    arc_cy = s * 0.50
    arc_top = arc_cy - arc_r
    bow_height = arc_top - y0

    # Vertikaler Balken
    if x0 <= px <= x1 and y0 <= py <= y1:
        return 1.0

    # Rechteck über dem Bogen
    if x0 <= px <= x_arc_end and y0 <= py <= y0 + bow_height:
        return 1.0

    # Halbkreis (Bogen)
    cx_arc = x_arc + arc_r
    dx = px - cx_arc
    if x_arc <= px <= x_arc_end and arc_top <= py <= arc_bot:
        dy = py - arc_cy
        if dx * dx + dy * dy <= arc_r * arc_r:
            return 1.0

    # Kantenglättung
    aa = 1.5

    # Zum Balken
    bar_d = min(
        abs(px - x0) if y0 <= py <= y1 else 999,
        abs(px - x1) if y0 <= py <= y1 else 999,
        abs(py - y0) if x0 <= px <= x1 else 999,
        abs(py - y1) if x0 <= px <= x1 else 999
    )

    # Zum Bogen-Rechteck
    rect_d = 999
    if x0 <= px <= x_arc_end:
        if abs(py - (y0 + bow_height)) < bow_height:
            rect_d = min(rect_d, abs(px - x0), abs(px - x_arc_end))

    # Zum Halbkreis
    arc_d = 999
    if x_arc - aa <= px <= x_arc_end + aa and arc_top - aa <= py <= arc_bot + aa:
        if px >= x_arc - aa:
            arc_d = abs(math.hypot(dx, py - arc_cy) - arc_r)

    d = min(bar_d, rect_d, arc_d)
    return max(0.0, min(1.0, 1.0 - d / aa)) if d < aa else 0.0


def render(size):
    radius = size * 0.22
    thickness = size * 0.20
    arc_bot = size * 0.74
    pixels = bytearray()

    for y in range(size):
        py = y + 0.5
        for x in range(size):
            px = x + 0.5

            bg_alpha = rounded_rect_alpha(px, py, size, radius)
            if bg_alpha <= 0:
                pixels += bytes((0, 0, 0, 0))
                continue

            base = lerp(TEAL_TOP, TEAL_BOTTOM, py / size)

            # P-Letter Alpha
            p_alpha = letter_alpha(px, py, size, thickness)
            if p_alpha > 0:
                color = [c + (w - c) * p_alpha for c, w in zip(base, WHITE)]
            else:
                color = list(base)

            alpha = round(255 * bg_alpha)
            pixels += bytes((round(color[0]), round(color[1]), round(color[2]), alpha))

    return pixels


def write_png(path, size, pixels):
    def chunk(tag, data):
        raw = struct.pack(">I", len(data)) + tag + data
        return raw + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw_rows = b"".join(
        b"\x00" + bytes(pixels[y * size * 4:(y + 1) * size * 4]) for y in range(size)
    )
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", header)
    png += chunk(b"IDAT", zlib.compress(raw_rows, 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as handle:
        handle.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(path, size, render(size))
        print(f"{path} ({os.path.getsize(path)} Bytes)")


if __name__ == "__main__":
    main()
