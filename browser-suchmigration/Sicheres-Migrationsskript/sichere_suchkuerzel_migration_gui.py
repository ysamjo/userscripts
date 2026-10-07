#!/usr/bin/env python3
"""GUI für sichere Suchkürzel-Migration zwischen Chromium-Browsern."""

from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from tkinter import (
    ttk,
    filedialog,
    messagebox,
    END,
    Listbox,
    MULTIPLE,
    SINGLE,
)
import tkinter as tk


# --- Browser-Konfiguration ---
HOME = Path.home()
BROWSERS = {
    "Chrome": HOME / "Library/Application Support/Google/Chrome",
    "Brave": HOME / "Library/Application Support/BraveSoftware/Brave-Browser",
    "Ego Lite": HOME / "Library/Application Support/Citro Labs/ego lite",
}


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


def db_columns(connection: sqlite3.Connection) -> set[str]:
    return {row[1] for row in connection.execute("PRAGMA table_info(keywords)")}


def read_keywords(web_data: Path) -> tuple[list[str], list[dict[str, object]]]:
    if not web_data.is_file():
        return [], []
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
                return [], []
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


def export_xml(profile: Path, output: Path) -> str:
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
    return f"Export gespeichert: {output}"


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


def import_xml(profile: Path, source: Path) -> tuple[str, Path]:
    provider, engines = parse_xml(source)
    if not engines:
        raise ValueError("Die XML-Datei enthält keine gültigen Suchmaschinen.")
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
        raise RuntimeError(
            f"Import fehlgeschlagen: {type(error).__name__}: {error}\n"
            f"Das unveränderte Backup liegt hier: {backup_path}"
        ) from error
    return f"Import abgeschlossen ({len(engines)} Suchmaschinen). Backup: {backup_path}", backup_path


# --- GUI ---
class SearchMigrationApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Suchkürzel-Migration")
        self.geometry("700x500")
        self.resizable(False, False)

        self.selected_browsers: list[str] = []
        self.selected_profile: Path | None = None
        self.export_file: Path | None = None

        self._build_ui()
        self._scan_browsers()

    def _build_ui(self) -> None:
        # Modus-Auswahl
        mode_frame = ttk.LabelFrame(self, text="Modus", padding=10)
        mode_frame.pack(fill="x", padx=10, pady=(10, 5))

        self.mode_var = tk.StringVar(value="export")
        ttk.Radiobutton(mode_frame, text="Export (Suchkürzel sichern)", variable=self.mode_var, value="export", command=self._on_mode_change).pack(side="left", padx=10)
        ttk.Radiobutton(mode_frame, text="Import (Suchkürzel einspielen)", variable=self.mode_var, value="import", command=self._on_mode_change).pack(side="left", padx=10)

        # Browser-Auswahl
        browser_frame = ttk.LabelFrame(self, text="Browser & Profil", padding=10)
        browser_frame.pack(fill="both", expand=True, padx=10, pady=5)

        # Linke Seite: Browser-Liste
        left_frame = ttk.Frame(browser_frame)
        left_frame.pack(side="left", fill="y", padx=(0, 10))

        ttk.Label(left_frame, text="Browser:").pack(anchor="w")
        self.browser_listbox = Listbox(left_frame, selectmode=MULTIPLE, height=6, exportselection=False)
        self.browser_listbox.pack(fill="x", pady=5)
        self.browser_listbox.bind("<<ListboxSelect>>", self._on_browser_select)

        ttk.Label(left_frame, text="Profil:").pack(anchor="w", pady=(10, 0))
        self.profile_listbox = Listbox(left_frame, selectmode=SINGLE, height=4)
        self.profile_listbox.pack(fill="x", pady=5)
        self.profile_listbox.bind("<<ListboxSelect>>", self._on_profile_select)

        # Rechte Seite: Status
        right_frame = ttk.Frame(browser_frame)
        right_frame.pack(side="left", fill="both", expand=True)

        ttk.Label(right_frame, text="Gefundene Suchmaschinen:").pack(anchor="w")
        self.engines_listbox = Listbox(right_frame, height=8)
        self.engines_listbox.pack(fill="both", expand=True, pady=5)

        # Datei-Auswahl
        file_frame = ttk.LabelFrame(self, text="XML-Datei", padding=10)
        file_frame.pack(fill="x", padx=10, pady=5)

        self.file_var = tk.StringVar(value="Keine Datei ausgewählt")
        ttk.Label(file_frame, textvariable=self.file_var).pack(side="left", fill="x", expand=True)
        ttk.Button(file_frame, text="Auswählen...", command=self._select_file).pack(side="right", padx=(5, 0))

        # Status & Aktionen
        action_frame = ttk.Frame(self)
        action_frame.pack(fill="x", padx=10, pady=10)

        self.status_var = tk.StringVar(value="Bereit")
        self.status_label = ttk.Label(action_frame, textvariable=self.status_var, foreground="blue")
        self.status_label.pack(side="left")

        ttk.Button(action_frame, text="Ausführen", command=self._execute).pack(side="right")

    def _scan_browsers(self) -> None:
        self.browser_listbox.delete(0, END)
        self.available_browsers: list[tuple[str, Path]] = []

        for name, root in BROWSERS.items():
            try:
                found = profiles(root)
            except PermissionError:
                self.available_browsers.append(None)
                self.browser_listbox.insert(END, f"{name} (kein Zugriff)")
                self.browser_listbox.itemconfig(END, fg="red")
                continue
            if found:
                # Wichtig: den Browser-Root ablegen, nicht found[0] (= ein Profil).
                # Sonst liefert profiles(root) in _on_browser_select nichts.
                self.available_browsers.append((name, root))
                self.browser_listbox.insert(END, f"{name} ({len(found)} Profile)")
                self.browser_listbox.itemconfig(END, fg="black")
            else:
                self.available_browsers.append(None)
                self.browser_listbox.insert(END, f"{name} (nicht gefunden)")
                self.browser_listbox.itemconfig(END, fg="gray")

        for index, entry in enumerate(self.available_browsers):
            if entry is not None:
                self.browser_listbox.selection_clear(0, END)
                self.browser_listbox.select_set(index)
                self._on_browser_select(None)
                break

    def _on_browser_select(self, event) -> None:
        selection = self.browser_listbox.curselection()
        if not selection:
            return
        entry = self.available_browsers[selection[0]]
        if entry is None:
            return
        name, root = entry
        self.profile_listbox.delete(0, END)

        for profile in profiles(root):
            self.profile_listbox.insert(END, profile.name)

        if self.profile_listbox.size() > 0:
            self.profile_listbox.select_set(0)
            self._on_profile_select(None)

    def _on_profile_select(self, event) -> None:
        selection = self.browser_listbox.curselection()
        if not selection:
            return
        entry = self.available_browsers[selection[0]]
        if entry is None:
            return
        name, root = entry
        profiles_found = profiles(root)

        profile_sel = self.profile_listbox.curselection()
        if not profile_sel:
            return

        profile = profiles_found[profile_sel[0]]
        self.selected_profile = profile
        self.selected_browser = name

        # Suchmaschinen laden
        self.engines_listbox.delete(0, END)
        try:
            _, rows = read_keywords(profile / "Web Data")
            for row in rows:
                keyword = row.get("keyword", "")
                short_name = row.get("short_name", "")
                self.engines_listbox.insert(END, f"{keyword}: {short_name}")
            self.status_label.config(foreground="blue")
            self.status_var.set(f"{len(rows)} Suchmaschinen in {name} gefunden")
        except PermissionError:
            self.status_label.config(foreground="red")
            self.status_var.set(f"PermissionError: Bitte {name} schließen oder Full Disk Access erlauben")
        except Exception as e:
            self.status_var.set(f"Fehler: {e}")

    def _on_mode_change(self) -> None:
        # Dateiauswahl zurücksetzen, ohne sofort einen Dialog zu öffnen.
        self.export_file = None
        self.file_var.set("Keine Datei ausgewählt")

    def _select_file(self) -> None:
        mode = self.mode_var.get()
        if mode == "export":
            path = filedialog.asksaveasfilename(
                title="Export-Datei speichern",
                defaultextension=".xml",
                filetypes=[("XML-Dateien", "*.xml"), ("Alle Dateien", "*.*")],
                initialdir=str(HOME / "Desktop"),
            )
        else:
            path = filedialog.askopenfilename(
                title="Import-Datei auswählen",
                filetypes=[("XML-Dateien", "*.xml"), ("Alle Dateien", "*.*")],
                initialdir=str(HOME / "Desktop"),
            )
        if path:
            self.export_file = Path(path)
            self.file_var.set(path)

    def _execute(self) -> None:
        mode = self.mode_var.get()
        profile = self.selected_profile

        if not profile:
            messagebox.showwarning("Fehler", "Bitte zuerst Browser und Profil auswählen.")
            return

        if not self.export_file:
            messagebox.showwarning("Fehler", "Bitte zuerst eine XML-Datei auswählen.")
            return

        browser = getattr(self, "selected_browser", "Unbekannt")

        # Warnung bei laufendem Browser: Änderungen können vom Browser
        # überschrieben werden und wirken erst nach einem Neustart.
        if browser_running(browser):
            if not messagebox.askyesno(
                "Browser läuft",
                f"{browser} läuft noch.\n\n"
                "Änderungen können vom laufenden Browser überschrieben werden\n"
                "und wirken erst nach einem Neustart des Browsers.\n\n"
                "Trotzdem fortfahren?",
            ):
                return

        try:
            if mode == "export":
                result = export_xml(profile, self.export_file)
                messagebox.showinfo("Erfolg", result)
            else:
                result, _ = import_xml(profile, self.export_file)
                messagebox.showinfo("Erfolg", result)

            self.status_var.set("Fertig!")

        except PermissionError:
            messagebox.showerror("PermissionError", f"Kein Zugriff auf {browser}-Daten.\n\nLösungen:\n1. {browser} vollständig beenden\n2. Bei Chrome: Full Disk Access in Systemeinstellungen → Datenschutz → Terminal erlauben")
        except Exception as e:
            messagebox.showerror("Fehler", str(e))
            self.status_var.set(f"Fehler: {e}")


if __name__ == "__main__":
    app = SearchMigrationApp()
    app.mainloop()
