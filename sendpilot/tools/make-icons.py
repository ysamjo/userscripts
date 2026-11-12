#!/usr/bin/env python3
"""Erzeugt die SendPilot-Icons als PNG (16/32/48/128 px) ohne externe Abhängigkeiten.

Motiv: abgerundetes Quadrat mit Blau-Verlauf, darin ein weißer Papierflieger.
Aufruf: python3 tools/make-icons.py
"""

import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

BLUE_TOP = (37, 99, 235)
BLUE_BOTTOM = (30, 58, 138)
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


def triangle_sd(p, a, b, c):
    """Signierte Distanz zu einem Dreieck (negativ innen)."""
    def sd_edge(pt, v, w):
        ex, ey = w[0] - v[0], w[1] - v[1]
        wrx, wry = pt[0] - v[0], pt[1] - v[1]
        t = max(0.0, min(1.0, (wrx * ex + wry * ey) / (ex * ex + ey * ey)))
        dx, dy = wrx - ex * t, wry - ey * t
        return math.hypot(dx, dy), (ex * wry - ey * wrx)

    d1, s1 = sd_edge(p, a, b)
    d2, s2 = sd_edge(p, b, c)
    d3, s3 = sd_edge(p, c, a)
    inside = (s1 < 0) == (s2 < 0) == (s3 < 0)
    d = min(d1, d2, d3)
    return -d if inside else d


def plane_polygons(size):
    """Papierflieger aus drei Dreiecken, relativ zur Icon-Größe."""
    s = size
    # Flügel oben (hell), Flügel unten (schattiert), Leitwerk
    wing_top = [(s * 0.12, s * 0.52), (s * 0.88, s * 0.16), (s * 0.44, s * 0.74)]
    wing_bottom = [(s * 0.12, s * 0.52), (s * 0.44, s * 0.74), (s * 0.52, s * 0.90)]
    tail = [(s * 0.44, s * 0.74), (s * 0.60, s * 0.56), (s * 0.56, s * 0.84)]
    return wing_top, wing_bottom, tail


def render(size):
    radius = size * 0.22
    wing_top, wing_bottom, tail = plane_polygons(size)
    pixels = bytearray()

    for y in range(size):
        py = y + 0.5
        for x in range(size):
            px = x + 0.5

            bg_alpha = rounded_rect_alpha(px, py, size, radius)
            if bg_alpha <= 0:
                pixels += bytes((0, 0, 0, 0))
                continue

            base = lerp(BLUE_TOP, BLUE_BOTTOM, py / size)

            d_top = triangle_sd((px, py), *wing_top)
            d_bottom = triangle_sd((px, py), *wing_bottom)
            d_tail = triangle_sd((px, py), *tail)

            # Kantenglättung über 1 px
            a_top = max(0.0, min(1.0, 0.5 - d_top))
            a_bottom = max(0.0, min(1.0, 0.5 - d_bottom)) * 0.82
            a_tail = max(0.0, min(1.0, 0.5 - d_tail)) * 0.68

            color = list(base)
            for a in (a_bottom, a_tail, a_top):
                if a <= 0:
                    continue
                color = [c + (w - c) * a for c, w in zip(color, WHITE)]

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
