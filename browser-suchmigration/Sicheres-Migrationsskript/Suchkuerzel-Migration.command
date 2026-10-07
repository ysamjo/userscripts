#!/bin/bash
cd "$(dirname "$0")"
# Finder-Start hat nicht den Homebrew-PATH -> python3 explizit sicherstellen.
export PATH="/opt/homebrew/bin:$PATH"
exec python3 sichere_suchkuerzel_migration_gui.py
