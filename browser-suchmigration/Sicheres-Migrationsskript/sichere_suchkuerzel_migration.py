#!/usr/bin/env python3
"""Sichere Export-/Import-Hilfe für Chromium-Suchkürzel.

Ändert ausschließlich Web Data (Tabelle keywords) und den
default_search_provider-Abschnitt in Preferences. Der Profilordner wird nie
gelöscht, verschoben oder ersetzt.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


HOME = Path.home()
BROWSERS = {
    "Chrome": HOME / "Library/Application Support/Google/Chrome",
    "Brave": HOME / "Library/Application Support/BraveSoftware/Brave-Browser",
}


def die(message: str) -> None:
    raise SystemExit(f"Fehler: {message}")


def profiles(browser_root: Path) -> list[Path]:
    if not browser_root.is_dir():
        return []
    return sorted(
        (p for p in browser_root.iterdir() if p.is_dir() and (p / "Preferences").is_file()),
        key=lambda p: (p.name != "Default", p.name.lower()),
    )


def choose(options: list[str], question: str) -> int:
    for i, option in enumerate(options, 1):
        print(f"  {i}) {option}")
    while True:
        try:
            value = int(input(f"{question} [1-{len(options)}]: "))
            if 1 <= value <= len(options):
                return value - 1
        except (EOFError, ValueError):
            pass
        print("Bitte eine gültige Nummer eingeben.")


def choose_browser() -> tuple[str, Path]:
    available = [(name, root) for name, root in BROWSERS.items() if profiles(root)]
    if not available:
        die("Kein Chrome- oder Brave-Profil gefunden.")
    index = choose([name for name, _ in available], "Browser auswählen")
    return available[index]


def choose_profile(root: Path) -> Path:
    found = profiles(root)
    if not found:
        die(f"Keine Profile in {root} gefunden.")
    labels = [f"{p.name} ({p / 'Preferences'})" for p in found]
    return found[choose(labels, "Profil auswählen")]


def browser_running(browser_name: str) -> bool:
    pattern = "Brave Browser" if browser_name == "Brave" else "Google Chrome"
    result = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    return bool(result.stdout.strip())


def require_closed(browser_name: str) -> None:
    if browser_running(browser_name):
        die(f"{browser_name} läuft noch. Bitte vollständig beenden und erneut starten.")


def db_columns(connection: sqlite3.Connection) -> set[str]:
    return {row[1] for row in connection.execute("PRAGMA table_info(keywords)")}


def read_keywords(web_data: Path) -> tuple[list[str], list[dict[str, object]]]:
    if not web_data.is_file():
        die(f"Web-Data-Datei fehlt: {web_data}")
    with sqlite3.connect(f"file:{web_data}?mode=ro", uri=True) as db:
        columns = sorted(db_columns(db))
        if not columns:
            die("Die keywords-Tabelle fehlt in Web Data.")
        rows = [dict(zip(columns, row)) for row in db.execute(f"SELECT {','.join(columns)} FROM keywords")]
    return columns, rows


def xml_value(parent: ET.Element, name: str, value: object) -> None:
    node = ET.SubElement(parent, "field", name=name)
    if value is None:
        node.set("type", "null")
    elif isinstance(value, bool):
        node.set("type", "bool")
        node.text = "true" if value else "false"
    elif isinstance(value, (int, float)):
        node.set("type", "number")
        node.text = str(value)
    else:
        node.set("type", "string")
        node.text = str(value)


def export_xml(profile: Path, output: Path) -> None:
    preferences = json.loads((profile / "Preferences").read_text(encoding="utf-8"))
    columns, rows = read_keywords(profile / "Web Data")
    root = ET.Element("browser-search-export", {"version": "1", "created": dt.datetime.now().isoformat()})
    provider = ET.SubElement(root, "default-search-provider")
    provider.text = json.dumps(preferences.get("default_search_provider"), ensure_ascii=False)
    engines = ET.SubElement(root, "search-engines")
    engines.set("columns", ",".join(columns))
    for row in rows:
        engine = ET.SubElement(engines, "engine")
        for column in columns:
            xml_value(engine, column, row.get(column))
    output.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
    print(f"Export gespeichert: {output}")


def parse_xml(source: Path) -> tuple[object, list[dict[str, object]]]:
    root = ET.parse(source).getroot()
    provider_node = root.find("default-search-provider")
    provider = json.loads(provider_node.text) if provider_node is not None and provider_node.text else None
    engines: list[dict[str, object]] = []
    for engine in root.findall("./search-engines/engine"):
        row: dict[str, object] = {}
        for field in engine.findall("field"):
            kind = field.get("type", "string")
            text = field.text or ""
            row[field.get("name", "")] = None if kind == "null" else (
                text == "true" if kind == "bool" else float(text) if kind == "number" and "." in text else int(text) if kind == "number" else text
            )
        if row.get("keyword") and row.get("url"):
            engines.append(row)
    return provider, engines


def backup(profile: Path) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = profile / "Search-Migration-Backups" / stamp
    target.mkdir(parents=True, exist_ok=False)
    for name in ("Preferences", "Web Data"):
        source = profile / name
        if source.is_file():
            shutil.copy2(source, target / name)
    return target


def atomic_json_write(path: Path, value: object) -> None:
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def import_xml(profile: Path, browser_name: str, source: Path) -> None:
    require_closed(browser_name)
    provider, engines = parse_xml(source)
    if not engines:
        die("Die XML-Datei enthält keine gültigen Suchmaschinen.")
    backup_path = backup(profile)
    try:
        preferences_path = profile / "Preferences"
        preferences = json.loads(preferences_path.read_text(encoding="utf-8"))
        preferences["default_search_provider"] = provider
        atomic_json_write(preferences_path, preferences)

        web_data = profile / "Web Data"
        with sqlite3.connect(web_data) as db:
            columns = db_columns(db)
            for row in engines:
                keyword = row["keyword"]
                existing = db.execute("SELECT id FROM keywords WHERE keyword = ?", (keyword,)).fetchone()
                updates = {key: value for key, value in row.items() if key in columns and key != "id"}
                if existing:
                    assignments = ",".join(f"{key} = ?" for key in updates)
                    db.execute(f"UPDATE keywords SET {assignments} WHERE id = ?", (*updates.values(), existing[0]))
                else:
                    inserts = {key: value for key, value in updates.items() if key in {"short_name", "keyword", "url", "favicon_url"}}
                    names = ",".join(inserts)
                    marks = ",".join("?" for _ in inserts)
                    db.execute(f"INSERT INTO keywords ({names}) VALUES ({marks})", tuple(inserts.values()))
            db.commit()
    except Exception:
        print(f"Änderung fehlgeschlagen. Das Backup liegt hier: {backup_path}", file=sys.stderr)
        raise
    print(f"Import abgeschlossen. Backup: {backup_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Suchkürzel sicher zwischen Chrome und Brave übertragen")
    parser.add_argument("--export", dest="export_path", type=Path, help="XML-Zieldatei")
    parser.add_argument("--import", dest="import_path", type=Path, help="XML-Quelldatei")
    args = parser.parse_args()
    if bool(args.export_path) == bool(args.import_path):
        die("Bitte genau eine Option angeben: --export DATEI oder --import DATEI")
    browser_name, root = choose_browser()
    profile = choose_profile(root)
    require_closed(browser_name) if args.export_path else None
    if args.export_path:
        export_xml(profile, args.export_path)
    else:
        import_xml(profile, browser_name, args.import_path)


if __name__ == "__main__":
    main()
