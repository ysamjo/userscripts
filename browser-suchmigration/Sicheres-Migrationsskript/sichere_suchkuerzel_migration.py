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
    "Ego Lite": HOME / "Library/Application Support/Citro Labs/ego lite",
}


def die(message: str) -> None:
    raise SystemExit(f"Fehler: {message}")


def profiles(browser_root: Path) -> list[Path]:
    """Profile eines Browser-Roots. Wirft PermissionError mit Hinweistext."""
    if not browser_root.is_dir():
        return []
    try:
        found = sorted(
            (p for p in browser_root.iterdir() if p.is_dir() and (p / "Preferences").is_file()),
            key=lambda p: (p.name != "Default", p.name.lower()),
        )
    except PermissionError as error:
        raise PermissionError(
            f"macOS verweigert den Zugriff auf {browser_root}.\n\n"
            "Lösung: Systemeinstellungen → Datenschutz & Sicherheit → "
            "Vollzugriff → die aufrufende App (Terminal, iTerm, …) aktivieren "
            "und das Skript danach neu starten."
        ) from error
    return found


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
    available: list[tuple[str, Path]] = []
    for name, root in BROWSERS.items():
        try:
            found = profiles(root)
        except PermissionError as error:
            print(f"  {name}: kein Zugriff — {error}")
            continue
        if found:
            available.append((name, root))
    if not available:
        die("Kein zugängliches Browser-Profil gefunden.")
    index = choose([name for name, _ in available], "Browser auswählen")
    return available[index]


def choose_profile(root: Path) -> Path:
    found = profiles(root)
    if not found:
        die(f"Keine Profile in {root} gefunden.")
    labels = [f"{p.name} ({p / 'Preferences'})" for p in found]
    return found[choose(labels, "Profil auswählen")]


def browser_running(browser_name: str) -> bool:
    patterns = {
        "Chrome": ["Google Chrome", "Google Chrome Helper"],
        "Brave": ["Brave Browser"],
        "Ego Lite": ["ego lite"],
    }
    search_patterns = patterns.get(browser_name, [browser_name])
    for pattern in search_patterns:
        result = subprocess.run(["pgrep", "-fl", pattern], capture_output=True, text=True)
        if result.stdout.strip():
            return True
    return False


def confirm_while_running(browser_name: str) -> bool:
    """Warnt bei laufendem Browser und fragt, ob trotzdem fortgefahren wird.

    Lesezugriffe (Export) sind neben einem laufenden Browser meist unkritisch.
    Schreibzugriffe (Import) können vom Browser überschrieben werden und wirken
    erst nach einem Neustart – der Nutzer entscheidet selbst.
    """
    if not browser_running(browser_name):
        return True
    print(
        f"WARNUNG: {browser_name} läuft noch.\n"
        "Änderungen können vom laufenden Browser überschrieben werden und\n"
        "wirken erst nach einem Neustart des Browsers."
    )
    answer = input("Trotzdem fortfahren? (j/n) [n]: ").strip().lower()
    return answer in {"j", "ja", "y", "yes"}


def db_columns(connection: sqlite3.Connection) -> set[str]:
    return {row[1] for row in connection.execute("PRAGMA table_info(keywords)")}


def read_keywords(web_data: Path) -> tuple[list[str], list[dict[str, object]]]:
    if not web_data.is_file():
        die(f"Web-Data-Datei fehlt: {web_data}")
    # Ein laufender Browser hält Web Data (WAL) gesperrt. Deshalb wird
    # aus einer temporären Kopie gelesen, inklusive -wal/-shm, damit
    # noch nicht checkpointete Änderungen sichtbar werden.
    with tempfile.TemporaryDirectory(prefix="webdata-snapshot-") as temporary:
        snapshot = Path(temporary) / "Web Data"
        shutil.copy2(web_data, snapshot)
        for suffix in ("-wal", "-shm"):
            sidecar = Path(f"{web_data}{suffix}")
            if sidecar.is_file():
                shutil.copy2(sidecar, Path(f"{snapshot}{suffix}"))
        with sqlite3.connect(snapshot, timeout=30) as db:
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
    base = profile / "Search-Migration-Backups"
    target = base / stamp
    # Zwei Importe in derselben Sekunde dürfen nicht kollidieren.
    counter = 2
    while target.exists():
        target = base / f"{stamp}-{counter}"
        counter += 1
    target.mkdir(parents=True)
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


def import_xml(profile: Path, source: Path) -> None:
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
        with sqlite3.connect(web_data, timeout=30) as db:
            columns = db_columns(db)
            for row in engines:
                keyword = row["keyword"]
                existing = db.execute("SELECT id FROM keywords WHERE keyword = ?", (keyword,)).fetchone()
                # url_hash nicht übernehmen: pro Browser berechnet, sonst
                # kollidiert der Import mit der lokalen Historie.
                updates = {
                    key: value
                    for key, value in row.items()
                    if key in columns and key not in {"id", "url_hash"}
                }
                if existing:
                    if not updates:
                        continue
                    assignments = ",".join(f"{key} = ?" for key in updates)
                    db.execute(f"UPDATE keywords SET {assignments} WHERE id = ?", (*updates.values(), existing[0]))
                else:
                    inserts = {key: value for key, value in updates.items() if key in {"short_name", "keyword", "url", "favicon_url", "input_encodings", "suggest_url"}}
                    names = ",".join(inserts)
                    marks = ",".join("?" for _ in inserts)
                    db.execute(f"INSERT INTO keywords ({names}) VALUES ({marks})", tuple(inserts.values()))
            db.commit()
    except Exception as error:
        print(
            f"Änderung fehlgeschlagen ({type(error).__name__}: {error}).\n"
            f"Das unveränderte Backup liegt hier: {backup_path}",
            file=sys.stderr,
        )
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
    if not confirm_while_running(browser_name):
        die("Abgebrochen.")
    if args.export_path:
        export_xml(profile, args.export_path)
    else:
        import_xml(profile, args.import_path)


if __name__ == "__main__":
    main()
