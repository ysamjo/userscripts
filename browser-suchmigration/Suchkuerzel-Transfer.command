#!/usr/bin/env python3
"""Einzeldatei-Transfer für Chrome-, Brave- und Firefox-Suchkürzel auf macOS."""

from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable


MAX_XML_SIZE = 750_000
MAX_FIREFOX_HTML_SIZE = 1_500_000
MAX_SHORTCUTS = 1_000
BACKUP_DIR = Path.home() / "Documents" / "Suchkuerzel-Backups"
BROWSERS = {
    "chrome": {
        "label": "Google Chrome",
        "process": "Google Chrome",
        "root": Path.home() / "Library" / "Application Support" / "Google" / "Chrome",
    },
    "brave": {
        "label": "Brave",
        "process": "Brave Browser",
        "root": Path.home()
        / "Library"
        / "Application Support"
        / "BraveSoftware"
        / "Brave-Browser",
    },
}
FIELDS = ("short_name", "keyword", "url", "favicon_url", "suggest_url", "input_encodings")


class TransferError(RuntimeError):
    pass


class Cancelled(Exception):
    pass


def applescript(script: str, *arguments: str) -> str:
    result = subprocess.run(
        ["osascript", "-e", script, "--", *arguments],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        if "-128" in result.stderr or "User canceled" in result.stderr:
            raise Cancelled
        raise TransferError(result.stderr.strip() or "Der macOS-Dialog konnte nicht geöffnet werden.")
    return result.stdout.strip()


def choose_from_list(title: str, prompt: str, choices: list[str]) -> str:
    if not choices:
        raise TransferError("Keine Auswahl vorhanden.")
    script = """
on run argv
  set dialogTitle to item 1 of argv
  set dialogPrompt to item 2 of argv
  set itemsList to items 3 thru -1 of argv
  set picked to choose from list itemsList with title dialogTitle with prompt dialogPrompt
  if picked is false then error number -128
  return item 1 of picked
end run
"""
    return applescript(script, title, prompt, *choices)


def choose_save_path(default_name: str) -> Path:
    script = """
on run argv
  set chosenFile to choose file name with prompt "XML-Export speichern" default name (item 1 of argv)
  return POSIX path of chosenFile
end run
"""
    path = Path(applescript(script, default_name)).expanduser()
    return path if path.suffix.lower() == ".xml" else path.with_suffix(".xml")


def choose_firefox_save_path(default_name: str) -> Path:
    script = """
on run argv
  set chosenFile to choose file name with prompt "Firefox-Importdatei speichern" default name (item 1 of argv)
  return POSIX path of chosenFile
end run
"""
    path = Path(applescript(script, default_name)).expanduser()
    return path if path.suffix.lower() in {".html", ".htm"} else path.with_suffix(".html")


def choose_xml_file() -> Path:
    script = """
set chosenFile to choose file with prompt "Suchkürzel-XML auswählen"
return POSIX path of chosenFile
"""
    return Path(applescript(script)).expanduser()


def confirm(title: str, message: str, action: str) -> None:
    script = """
on run argv
  display dialog (item 2 of argv) with title (item 1 of argv) buttons {"Abbrechen", item 3 of argv} default button (item 3 of argv) cancel button "Abbrechen" with icon caution
end run
"""
    applescript(script, title, message, action)


def alert(title: str, message: str, kind: str = "informational") -> None:
    icon = "stop" if kind == "error" else "note"
    script = f"""
on run argv
  display alert (item 1 of argv) message (item 2 of argv) as {icon}
end run
"""
    applescript(script, title, message)


def ask_retry_locked(label: str) -> None:
    script = """
on run argv
  display dialog ((item 1 of argv) & " ist noch geöffnet.\n\nBrowser vollständig schließen, kurz warten und dann erneut prüfen.") with title "Browser schließen" buttons {"Abbrechen", "Erneut prüfen"} default button "Erneut prüfen" cancel button "Abbrechen" with icon caution
end run
"""
    applescript(script, label)


def chrome_time_now() -> int:
    return int((time.time() + 11_644_473_600) * 1_000_000)


def safe_component(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
    return value or "profil"


def profile_name(profile_dir: Path) -> str:
    try:
        preferences = json.loads((profile_dir / "Preferences").read_text(encoding="utf-8"))
        name = preferences.get("profile", {}).get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    except (OSError, ValueError, TypeError):
        pass
    return "Standard" if profile_dir.name == "Default" else profile_dir.name


def profile_sort_key(path: Path) -> tuple[int, int, str]:
    if path.name == "Default":
        return (0, 0, path.name)
    match = re.fullmatch(r"Profile (\d+)", path.name)
    return (1, int(match.group(1)), path.name) if match else (2, 0, path.name.lower())


def open_db(path: Path, *, read_only: bool, timeout: float = 5.0) -> sqlite3.Connection:
    if not path.is_file():
        raise TransferError("Die Suchkürzel-Datenbank fehlt.")
    if read_only:
        connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=timeout)
    else:
        connection = sqlite3.connect(path, timeout=timeout)
    connection.row_factory = sqlite3.Row
    connection.execute(f"PRAGMA busy_timeout={max(1, int(timeout * 1000))}")
    return connection


def columns(connection: sqlite3.Connection) -> set[str]:
    names = {str(row[1]) for row in connection.execute("PRAGMA table_info(keywords)")}
    if not {"id", "short_name", "keyword", "url"}.issubset(names):
        raise TransferError("Unbekanntes Chrome-Datenbankformat.")
    return names


def is_locked(error: BaseException) -> bool:
    return isinstance(error, sqlite3.OperationalError) and "locked" in str(error).lower()


def digest(path: Path) -> bytes:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.digest()


def copy_database_set(source: Path, destination: Path) -> bytes:
    combined = hashlib.sha256()
    for suffix in ("", "-wal"):
        source_file = Path(f"{source}{suffix}")
        if not source_file.is_file() or source_file.stat().st_size == 0:
            continue
        target = Path(f"{destination}{suffix}")
        shutil.copy2(source_file, target)
        combined.update(suffix.encode("ascii"))
        combined.update(digest(target))
    return combined.digest()


@contextmanager
def stable_snapshot(db_path: Path):
    with tempfile.TemporaryDirectory(prefix="suchkuerzel-") as temp_dir:
        root = Path(temp_dir)
        first, second = root / "first.sqlite", root / "second.sqlite"
        journal = Path(f"{db_path}-journal")
        for _ in range(8):
            if journal.is_file() and journal.stat().st_size > 0:
                time.sleep(0.08)
                continue
            try:
                for target in (first, second):
                    for suffix in ("", "-wal"):
                        candidate = Path(f"{target}{suffix}")
                        if candidate.exists():
                            candidate.unlink()
                first_digest = copy_database_set(db_path, first)
                second_digest = copy_database_set(db_path, second)
            except OSError:
                time.sleep(0.08)
                continue
            if first_digest == second_digest:
                yield second
                return
        raise TransferError("Die gesperrte Browserdatenbank konnte nicht stabil gelesen werden.")


def with_read_db(path: Path, operation):
    connection: sqlite3.Connection | None = None
    try:
        connection = open_db(path, read_only=True, timeout=0.4)
        return operation(connection)
    except sqlite3.OperationalError as error:
        if not is_locked(error):
            raise
    finally:
        if connection is not None:
            connection.close()
    with stable_snapshot(path) as snapshot:
        connection = open_db(snapshot, read_only=True)
        try:
            return operation(connection)
        finally:
            connection.close()


def custom_conditions(existing_columns: set[str]) -> list[str]:
    result = []
    for name in ("prepopulate_id", "created_by_policy", "starter_pack_id", "enforced_by_policy"):
        if name in existing_columns:
            result.append(f"COALESCE({name}, 0) = 0")
    if "is_active" in existing_columns:
        result.append("COALESCE(is_active, 0) = 1")
    return result


def read_shortcuts(path: Path) -> list[dict[str, str]]:
    def operation(connection: sqlite3.Connection) -> list[dict[str, str]]:
        existing_columns = columns(connection)
        selected = [field for field in FIELDS if field in existing_columns]
        where = " AND ".join(custom_conditions(existing_columns)) or "1 = 1"
        rows = connection.execute(
            f"SELECT {', '.join(selected)} FROM keywords WHERE {where} ORDER BY lower(keyword), lower(short_name)"
        ).fetchall()
        return [{field: str(row[field] or "") for field in FIELDS} for row in rows]
    return with_read_db(path, operation)


def search_item_from_row(row: sqlite3.Row) -> dict[str, str]:
    available = set(row.keys())
    item = {field: str(row[field] or "") if field in available else "" for field in FIELDS}
    item["prepopulate_id"] = str(row["prepopulate_id"] or 0) if "prepopulate_id" in available else "0"
    item["sync_guid"] = str(row["sync_guid"] or "") if "sync_guid" in available else ""
    return item


def search_item_from_preferences(data: Any) -> dict[str, str] | None:
    if not isinstance(data, dict):
        return None
    encodings = data.get("input_encodings", "")
    if isinstance(encodings, list):
        encodings = ";".join(str(value) for value in encodings)
    item = {
        "short_name": str(data.get("short_name") or ""),
        "keyword": str(data.get("keyword") or ""),
        "url": str(data.get("url") or ""),
        "favicon_url": str(data.get("favicon_url") or ""),
        "suggest_url": str(data.get("suggestions_url") or data.get("suggest_url") or ""),
        "input_encodings": str(encodings or ""),
        "prepopulate_id": str(data.get("prepopulate_id") or 0),
        "sync_guid": str(data.get("synced_guid") or data.get("sync_guid") or ""),
    }
    if not item["short_name"] or not item["keyword"] or "{searchTerms}" not in item["url"]:
        return None
    return item


def read_default_search(profile: dict[str, Any]) -> dict[str, str] | None:
    preferences_path = profile["directory"] / "Preferences"
    try:
        preferences = json.loads(preferences_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    guid = str(preferences.get("default_search_provider", {}).get("guid") or "")

    if guid:
        def by_guid(connection: sqlite3.Connection) -> dict[str, str] | None:
            if "sync_guid" not in columns(connection):
                return None
            row = connection.execute(
                "SELECT * FROM keywords WHERE sync_guid = ? COLLATE NOCASE LIMIT 1", (guid,)
            ).fetchone()
            return search_item_from_row(row) if row else None

        provider = with_read_db(profile["path"], by_guid)
        if provider:
            return provider

    mirrored = preferences.get("default_search_provider_data", {}).get("mirrored_template_url_data")
    provider = search_item_from_preferences(mirrored)
    if provider:
        return provider

    secure_path = profile["directory"] / "Secure Preferences"
    try:
        secure_preferences = json.loads(secure_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return search_item_from_preferences(
        secure_preferences.get("default_search_provider_data", {}).get("template_url_data")
    )


def read_search_engines(path: Path) -> list[dict[str, str]]:
    def operation(connection: sqlite3.Connection) -> list[dict[str, str]]:
        existing_columns = columns(connection)
        starter_condition = "COALESCE(starter_pack_id, 0) = 0" if "starter_pack_id" in existing_columns else "1 = 1"
        rows = connection.execute(
            f"SELECT * FROM keywords WHERE {starter_condition} ORDER BY lower(short_name), lower(keyword)"
        ).fetchall()
        result = []
        for row in rows:
            item = search_item_from_row(row)
            if "{searchTerms}" not in item["url"] or item["url"].startswith(("chrome://", "brave://")):
                continue
            result.append(item)
        return result

    return with_read_db(path, operation)


def choose_default_search(profile: dict[str, Any]) -> dict[str, str]:
    detected = read_default_search(profile)
    if detected:
        return detected
    engines = read_search_engines(profile["path"])
    if not engines:
        raise TransferError("Die Standardsuchmaschine konnte nicht gelesen werden.")
    labels = [f"{item['short_name']} — {item['keyword']}" for item in engines]
    picked = choose_from_list(
        "Standardsuche auswählen",
        "Die Standardsuche konnte nicht eindeutig erkannt werden. Welche ist eingestellt?",
        labels,
    )
    return engines[labels.index(picked)]


def discover_profiles() -> list[dict[str, Any]]:
    result = []
    for browser_key, browser in BROWSERS.items():
        root = browser["root"]
        if not root.is_dir():
            continue
        candidates = sorted(
            (item for item in root.iterdir() if item.is_dir() and (item / "Web Data").is_file()),
            key=profile_sort_key,
        )
        for directory in candidates:
            try:
                count = len(read_shortcuts(directory / "Web Data"))
            except (OSError, sqlite3.Error, TransferError):
                continue
            result.append(
                {
                    "token": f"{browser_key}:{directory.name}",
                    "browser_key": browser_key,
                    "label": f"{browser['label']} — {profile_name(directory)}",
                    "directory": directory,
                    "path": directory / "Web Data",
                    "count": count,
                }
            )
    return result


def append_search_xml(parent: ET.Element, tag_name: str, item: dict[str, str]) -> None:
    node = ET.SubElement(parent, tag_name)
    for tag, field in (
        ("name", "short_name"),
        ("keyword", "keyword"),
        ("url", "url"),
        ("favicon-url", "favicon_url"),
        ("suggest-url", "suggest_url"),
        ("input-encodings", "input_encodings"),
        ("prepopulate-id", "prepopulate_id"),
        ("source-guid", "sync_guid"),
    ):
        ET.SubElement(node, tag).text = item.get(field, "")


def to_xml(
    shortcuts: Iterable[dict[str, str]],
    source: str,
    default_search: dict[str, str] | None = None,
) -> str:
    root = ET.Element(
        "search-shortcuts",
        {
            "version": "1",
            "exported-at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "source": source,
        },
    )
    if default_search:
        append_search_xml(root, "default-search", default_search)
    for shortcut in shortcuts:
        append_search_xml(root, "shortcut", shortcut)
    if hasattr(ET, "indent"):
        ET.indent(root, space="  ")
    data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    if len(data) > MAX_XML_SIZE:
        raise TransferError("Der XML-Export ist zu groß.")
    return data.decode("utf-8")


def to_firefox_html(shortcuts: Iterable[dict[str, str]], source: str) -> str:
    """Erzeugt eine Firefox-Lesezeichendatei mit SHORTCUTURL-Schlüsselwörtern."""
    items = list(shortcuts)
    if not items or len(items) > MAX_SHORTCUTS:
        raise TransferError("Keine oder zu viele Suchkürzel für Firefox.")
    timestamp = int(time.time())
    source_text = html.escape(source)
    lines = [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        "<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">",
        "<TITLE>Suchkürzel-Transfer</TITLE>",
        "<H1>Suchkürzel-Transfer</H1>",
        "<DL><p>",
        f"    <DT><H3 ADD_DATE=\"{timestamp}\">Suchkürzel aus {source_text}</H3>",
        "    <DL><p>",
    ]
    for item in items:
        firefox_url = item["url"].replace("{searchTerms}", "%s")
        lines.append(
            "        <DT><A "
            f"HREF=\"{html.escape(firefox_url, quote=True)}\" "
            f"ADD_DATE=\"{timestamp}\" "
            f"SHORTCUTURL=\"{html.escape(item['keyword'], quote=True)}\" "
            f"LAST_CHARSET=\"UTF-8\">{html.escape(item['short_name'])}</A>"
        )
    lines.extend(["    </DL><p>", "</DL><p>", ""])
    result = "\n".join(lines)
    if len(result.encode("utf-8")) > MAX_FIREFOX_HTML_SIZE:
        raise TransferError("Die Firefox-Importdatei ist zu groß.")
    return result


def node_text(node: ET.Element, tag: str) -> str:
    child = node.find(tag)
    return "" if child is None or child.text is None else child.text.strip()


def parse_search_xml_node(node: ET.Element, description: str) -> dict[str, str]:
    item = {
        "short_name": node_text(node, "name"),
        "keyword": node_text(node, "keyword"),
        "url": node_text(node, "url"),
        "favicon_url": node_text(node, "favicon-url"),
        "suggest_url": node_text(node, "suggest-url"),
        "input_encodings": node_text(node, "input-encodings") or "UTF-8",
        "prepopulate_id": node_text(node, "prepopulate-id") or "0",
        "sync_guid": node_text(node, "source-guid"),
    }
    if not item["short_name"] or not item["keyword"] or not item["url"]:
        raise TransferError(f"Bei {description} dürfen Name, Kürzel und URL nicht leer sein.")
    if "{searchTerms}" not in item["url"]:
        raise TransferError(f"Bei „{item['keyword']}“ fehlt {{searchTerms}} in der URL.")
    if not item["prepopulate_id"].isdigit():
        raise TransferError(f"Ungültige Standardsuchmaschinen-ID bei „{item['keyword']}“.")
    return item


def parse_transfer_xml(xml: str) -> tuple[list[dict[str, str]], dict[str, str] | None]:
    data = xml.encode("utf-8")
    if len(data) > MAX_XML_SIZE:
        raise TransferError("Die XML-Datei ist zu groß.")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise TransferError("Die XML-Datei ist ungültig.") from error
    if root.tag != "search-shortcuts" or root.attrib.get("version") != "1":
        raise TransferError("Nicht unterstütztes XML-Format.")
    nodes = root.findall("shortcut")
    default_nodes = root.findall("default-search")
    if len(default_nodes) > 1:
        raise TransferError("Die XML enthält mehrere Standardsuchmaschinen.")
    if (not nodes and not default_nodes) or len(nodes) > MAX_SHORTCUTS:
        raise TransferError("Die XML enthält keine Suchdaten oder zu viele Suchkürzel.")
    result, seen = [], set()
    for node in nodes:
        item = parse_search_xml_node(node, "einem Suchkürzel")
        normalized = item["keyword"].casefold()
        if normalized in seen:
            raise TransferError(f"Das Kürzel „{item['keyword']}“ kommt doppelt vor.")
        seen.add(normalized)
        result.append({field: item[field] for field in FIELDS})
    default_search = (
        parse_search_xml_node(default_nodes[0], "der Standardsuche") if default_nodes else None
    )
    return result, default_search


def parse_xml(xml: str) -> list[dict[str, str]]:
    return parse_transfer_xml(xml)[0]


def row_editable(row: sqlite3.Row, existing_columns: set[str]) -> bool:
    for name in ("prepopulate_id", "created_by_policy", "starter_pack_id", "enforced_by_policy"):
        if name in existing_columns and int(row[name] or 0) != 0:
            return False
    return True


def find_rows(connection: sqlite3.Connection, keyword: str) -> list[sqlite3.Row]:
    return connection.execute(
        "SELECT * FROM keywords WHERE keyword = ? COLLATE NOCASE ORDER BY id", (keyword,)
    ).fetchall()


def analyze(connection: sqlite3.Connection, entries: list[dict[str, str]]) -> dict[str, Any]:
    existing_columns = columns(connection)
    result: dict[str, Any] = {"added": 0, "updated": 0, "unchanged": 0, "conflicts": []}
    for item in entries:
        rows = find_rows(connection, item["keyword"])
        if not rows:
            result["added"] += 1
        elif len(rows) != 1 or not row_editable(rows[0], existing_columns):
            result["conflicts"].append(item["keyword"])
        elif all(str(rows[0][field] or "") == item[field] for field in FIELDS if field in existing_columns):
            result["unchanged"] += 1
        else:
            result["updated"] += 1
    return result


def preview(path: Path, entries: list[dict[str, str]]) -> dict[str, Any]:
    return with_read_db(path, lambda connection: analyze(connection, entries))


def matching_default_row(
    connection: sqlite3.Connection, item: dict[str, str]
) -> sqlite3.Row | None:
    existing_columns = columns(connection)
    row = connection.execute(
        "SELECT * FROM keywords WHERE keyword = ? COLLATE NOCASE AND url = ? ORDER BY id LIMIT 1",
        (item["keyword"], item["url"]),
    ).fetchone()
    if row:
        return row
    prepopulate_id = int(item.get("prepopulate_id") or 0)
    if prepopulate_id and "prepopulate_id" in existing_columns:
        row = connection.execute(
            "SELECT * FROM keywords WHERE prepopulate_id = ? ORDER BY id LIMIT 1",
            (prepopulate_id,),
        ).fetchone()
        if row:
            return row
    return connection.execute(
        "SELECT * FROM keywords WHERE url = ? ORDER BY id LIMIT 1", (item["url"],)
    ).fetchone()


def entries_for_import(
    path: Path,
    entries: list[dict[str, str]],
    default_search: dict[str, str] | None,
) -> list[dict[str, str]]:
    prepared = [dict(item) for item in entries]
    if not default_search:
        return prepared
    for item in prepared:
        if item["keyword"].casefold() == default_search["keyword"].casefold():
            if item["url"] != default_search["url"]:
                raise TransferError("Das Kürzel der Standardsuche hat in der XML zwei verschiedene URLs.")
            return prepared
    existing = with_read_db(path, lambda connection: matching_default_row(connection, default_search))
    if existing:
        return prepared
    prepared.append({field: default_search[field] for field in FIELDS})
    return prepared


def probe_write(path: Path, timeout: float = 0.35) -> None:
    connection = open_db(path, read_only=False, timeout=timeout)
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.rollback()
    finally:
        connection.close()


def backup(path: Path, label: str) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    destination_path = BACKUP_DIR / f"Web-Data-{safe_component(label)}-{stamp}.sqlite"
    source = open_db(path, read_only=True)
    destination = sqlite3.connect(destination_path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    os.chmod(destination_path, 0o600)
    return destination_path


def browser_running(profile: dict[str, Any]) -> bool:
    process_name = BROWSERS[profile["browser_key"]]["process"]
    return subprocess.run(
        ["pgrep", "-x", process_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    ).returncode == 0


def wait_until_import_ready(profile: dict[str, Any], require_closed: bool) -> None:
    while True:
        if require_closed and browser_running(profile):
            ask_retry_locked(profile["label"])
            continue
        try:
            probe_write(profile["path"])
            return
        except sqlite3.OperationalError as error:
            if not is_locked(error):
                raise
            ask_retry_locked(profile["label"])


def search_settings_command(profile: dict[str, Any]) -> list[str]:
    browser_key = profile["browser_key"]
    settings_url = "brave://settings/search" if browser_key == "brave" else "chrome://settings/search"
    profile_argument = f"--profile-directory={profile['directory'].name}"
    return [
        "open",
        "-a",
        BROWSERS[browser_key]["process"],
        "--args",
        profile_argument,
        settings_url,
    ]


def open_search_settings(profile: dict[str, Any]) -> None:
    subprocess.run(search_settings_command(profile), check=False)


def values_for(item: dict[str, str], now: int) -> dict[str, Any]:
    return {
        "short_name": item["short_name"],
        "keyword": item["keyword"],
        "favicon_url": item["favicon_url"],
        "url": item["url"],
        "safe_for_autoreplace": 0,
        "originating_url": "",
        "date_created": now,
        "usage_count": 0,
        "input_encodings": item["input_encodings"],
        "suggest_url": item["suggest_url"],
        "prepopulate_id": 0,
        "created_by_policy": 0,
        "last_modified": now,
        "sync_guid": str(uuid.uuid4()),
        "alternate_urls": "",
        "image_url": "",
        "search_url_post_params": "",
        "suggest_url_post_params": "",
        "image_url_post_params": "",
        "new_tab_url": "",
        "last_visited": 0,
        "created_from_play_api": 0,
        "is_active": 1,
        "starter_pack_id": 0,
        "enforced_by_policy": 0,
        "featured_by_policy": 0,
    }


def apply_import(path: Path, label: str, entries: list[dict[str, str]]) -> tuple[dict[str, Any], Path]:
    probe_write(path, 0.5)
    backup_path = backup(path, label)
    connection = open_db(path, read_only=False, timeout=3.0)
    try:
        connection.execute("BEGIN IMMEDIATE")
        result = analyze(connection, entries)
        if result["conflicts"]:
            raise TransferError("Kollisionen: " + ", ".join(result["conflicts"][:5]))
        existing_columns = columns(connection)
        now = chrome_time_now()
        for item in entries:
            rows = find_rows(connection, item["keyword"])
            values = values_for(item, now)
            if rows:
                selected = [
                    name
                    for name in (
                        "short_name", "keyword", "url", "favicon_url", "suggest_url",
                        "input_encodings", "is_active", "last_modified",
                    )
                    if name in existing_columns
                ]
                connection.execute(
                    f"UPDATE keywords SET {', '.join(f'{name} = ?' for name in selected)} WHERE id = ?",
                    [values[name] for name in selected] + [rows[0]["id"]],
                )
            else:
                selected = [name for name in values if name in existing_columns]
                connection.execute(
                    f"INSERT INTO keywords ({', '.join(selected)}) VALUES ({', '.join('?' for _ in selected)})",
                    [values[name] for name in selected],
                )
        connection.commit()
        return result, backup_path
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def choose_profile(profiles: list[dict[str, Any]], purpose: str) -> dict[str, Any]:
    labels = [f"{item['label']} — {item['count']} Kürzel" for item in profiles]
    picked = choose_from_list("Suchkürzel-Transfer", purpose, labels)
    return profiles[labels.index(picked)]


def export_flow(profiles: list[dict[str, Any]]) -> None:
    profile = choose_profile(profiles, "Quellprofil für den XML-Export auswählen:")
    shortcuts = read_shortcuts(profile["path"])
    default_search = choose_default_search(profile)
    date = dt.date.today().isoformat()
    filename = f"Suchkuerzel-{safe_component(profile['label'])}-{date}.xml"
    destination = choose_save_path(filename)
    destination.write_text(
        to_xml(shortcuts, profile["label"], default_search), encoding="utf-8"
    )
    alert(
        "Export abgeschlossen",
        f"{len(shortcuts)} Suchkürzel gespeichert\n"
        f"Standardsuche: {default_search['short_name']} ({default_search['keyword']})\n\n"
        f"{destination}",
    )


def firefox_export_flow(profiles: list[dict[str, Any]]) -> None:
    profile = choose_profile(profiles, "Chrome-/Brave-Quellprofil für Firefox auswählen:")
    shortcuts = read_shortcuts(profile["path"])
    if not shortcuts:
        raise TransferError("Dieses Profil enthält keine aktiven eigenen Suchkürzel.")
    date = dt.date.today().isoformat()
    filename = f"Firefox-Suchkuerzel-{safe_component(profile['label'])}-{date}.html"
    destination = choose_firefox_save_path(filename)
    destination.write_text(to_firefox_html(shortcuts, profile["label"]), encoding="utf-8")
    subprocess.run(["open", "-R", str(destination)], check=False)
    alert(
        "Firefox-Datei erstellt",
        f"{len(shortcuts)} Suchkürzel gespeichert:\n{destination}\n\n"
        "In Firefox:\n"
        "1. ⌘⇧O drücken\n"
        "2. „Importieren und Sichern“ wählen\n"
        "3. „Lesezeichen von HTML importieren“ wählen\n"
        "4. Diese Datei öffnen",
    )


def import_flow(profiles: list[dict[str, Any]]) -> None:
    profile = choose_profile(profiles, "Zielprofil für den XML-Import auswählen:")
    xml_path = choose_xml_file()
    entries, default_search = parse_transfer_xml(xml_path.read_text(encoding="utf-8"))
    entries = entries_for_import(profile["path"], entries, default_search)
    result = preview(profile["path"], entries)
    if result["conflicts"]:
        raise TransferError("Geschützte oder doppelte Kürzel kollidieren: " + ", ".join(result["conflicts"][:5]))
    default_message = (
        f"\nStandardsuche: {default_search['short_name']} ({default_search['keyword']})\n"
        if default_search
        else "\nStandardsuche: nicht in dieser XML enthalten\n"
    )
    confirm(
        "Import bestätigen",
        f"Ziel: {profile['label']}\n\n{result['added']} neu\n{result['updated']} zu aktualisieren\n"
        f"{result['unchanged']} unverändert\n{default_message}\n"
        "Nichts wird gelöscht. Vorher werden Sicherungen erstellt.",
        "Importieren",
    )
    wait_until_import_ready(profile, require_closed=bool(default_search))
    final, backup_path = apply_import(profile["path"], profile["label"], entries)
    default_finish = (
        f"\n\nAls Nächstes öffnet sich die Browser-Einstellung. Dort bitte „{default_search['short_name']}“ als Standardsuche auswählen."
        if default_search
        else ""
    )
    alert(
        "Import abgeschlossen",
        f"{final['added']} neu, {final['updated']} aktualisiert.\n\n"
        f"Sicherung:\n{backup_path}{default_finish}",
    )
    if default_search:
        open_search_settings(profile)


def self_test() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        profile_dir = Path(temp_dir)
        db_path = profile_dir / "Web Data"
        schema = """
        CREATE TABLE keywords (
          id INTEGER PRIMARY KEY, short_name VARCHAR NOT NULL, keyword VARCHAR NOT NULL,
          favicon_url VARCHAR NOT NULL, url VARCHAR NOT NULL, safe_for_autoreplace INTEGER,
          originating_url VARCHAR, date_created INTEGER DEFAULT 0, usage_count INTEGER DEFAULT 0,
          input_encodings VARCHAR, suggest_url VARCHAR, prepopulate_id INTEGER DEFAULT 0,
          created_by_policy INTEGER DEFAULT 0, last_modified INTEGER DEFAULT 0, sync_guid VARCHAR,
          alternate_urls VARCHAR, image_url VARCHAR, search_url_post_params VARCHAR,
          suggest_url_post_params VARCHAR, image_url_post_params VARCHAR, new_tab_url VARCHAR,
          last_visited INTEGER DEFAULT 0, created_from_play_api INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 0, starter_pack_id INTEGER DEFAULT 0,
          enforced_by_policy INTEGER DEFAULT 0, featured_by_policy INTEGER DEFAULT 0, url_hash BLOB
        );
        """
        connection = sqlite3.connect(db_path)
        try:
            connection.executescript(schema)
            connection.execute(
                "INSERT INTO keywords (short_name,keyword,favicon_url,url,input_encodings,is_active,sync_guid) VALUES ('Test','t','','https://example.test/?q={searchTerms}','UTF-8',1,'test-guid')"
            )
            connection.commit()
        finally:
            connection.close()
        (profile_dir / "Preferences").write_text(
            json.dumps({"default_search_provider": {"guid": "test-guid"}}), encoding="utf-8"
        )
        profile = {"directory": profile_dir, "path": db_path}
        rows = read_shortcuts(db_path)
        assert len(rows) == 1 and rows[0]["keyword"] == "t"
        default_search = read_default_search(profile)
        assert default_search and default_search["keyword"] == "t"
        transfer_xml = to_xml(rows, "Test", default_search)
        parsed, parsed_default = parse_transfer_xml(transfer_xml)
        assert parsed == rows
        assert parsed_default and parsed_default["sync_guid"] == "test-guid"
        assert parse_transfer_xml(to_xml(rows, "Alt"))[1] is None
        assert entries_for_import(db_path, rows, parsed_default) == rows
        command = search_settings_command(
            {"browser_key": "chrome", "directory": Path("/tmp/Profile 7")}
        )
        assert "--profile-directory=Profile 7" in command
        assert command[-1] == "chrome://settings/search"
        firefox_html = to_firefox_html(rows, "Test & Quelle")
        assert 'SHORTCUTURL="t"' in firefox_html
        assert "https://example.test/?q=%s" in firefox_html
        assert "{searchTerms}" not in firefox_html
        assert "Test &amp; Quelle" in firefox_html
        result = preview(db_path, parsed)
        assert result == {"added": 0, "updated": 0, "unchanged": 1, "conflicts": []}
        locker = sqlite3.connect(db_path)
        try:
            locker.execute("PRAGMA locking_mode=EXCLUSIVE")
            locker.execute("BEGIN EXCLUSIVE")
            assert read_shortcuts(db_path)[0]["keyword"] == "t"
        finally:
            locker.rollback()
            locker.close()
    print("Selbsttest erfolgreich")


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        return 0
    try:
        profiles = discover_profiles()
        if not profiles:
            raise TransferError("Keine verwendbaren Chrome- oder Brave-Profile gefunden.")
        action = choose_from_list(
            "Suchkürzel-Transfer",
            "Was möchtest du tun?",
            [
                "Als XML exportieren",
                "Aus XML in Chrome/Brave importieren",
                "Für Firefox exportieren",
            ],
        )
        if action == "Als XML exportieren":
            export_flow(profiles)
        elif action == "Aus XML in Chrome/Brave importieren":
            import_flow(profiles)
        else:
            firefox_export_flow(profiles)
        return 0
    except Cancelled:
        return 0
    except Exception as error:
        try:
            alert("Suchkürzel-Transfer", str(error), "error")
        except Cancelled:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
