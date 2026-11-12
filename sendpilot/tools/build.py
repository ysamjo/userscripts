#!/usr/bin/env python3
"""Baut sendpilot.zip (Chrome Web Store / Laden-entpackt) aus dem Extension-Ordner.

Aufruf:  python3 tools/build.py
Ergebnis: dist/sendpilot-<version>.zip
"""

import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

# Alles, was mit ins Paket gehört (relativ zum Extension-Ordner)
INCLUDE = [
    "manifest.json",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "src/background.js",
    "src/paketda.js",
    "src/klick-n-schick.js",
    "popup/popup.html",
    "popup/popup.css",
    "popup/popup.js",
    "popup/options.html",
    "popup/options.css",
    "popup/options.js",
    "popup/lib.js"
]

SKIP_DIRS = {".git", "dist", "tests", "tools", ".screenshots", "node_modules"}


def main():
    manifest_path = os.path.join(ROOT, "manifest.json")
    with open(manifest_path, encoding="utf-8") as handle:
        version = json.load(handle)["version"]

    os.makedirs(DIST, exist_ok=True)
    target = os.path.join(DIST, f"sendpilot-{version}.zip")

    missing = [path for path in INCLUDE if not os.path.exists(os.path.join(ROOT, path))]
    if missing:
        raise SystemExit("Fehlende Dateien: " + ", ".join(missing))

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in INCLUDE:
            archive.write(os.path.join(ROOT, path), path)

    print(f"{target} ({os.path.getsize(target)} Bytes, {len(INCLUDE)} Dateien)")


if __name__ == "__main__":
    main()
