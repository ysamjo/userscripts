#!/usr/bin/env python3
"""Plattformübergreifende Oberfläche für den vorhandenen Suchkürzel-Transfer."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QApplication, QFileDialog, QInputDialog, QMessageBox


ROOT = Path(__file__).resolve().parents[1]
bundle_root = Path(getattr(sys, "_MEIPASS", ROOT))
transfer_candidates = (
    bundle_root / "Suchkuerzel-Transfer.command",
    Path(sys.executable).resolve().parent.parent / "Resources" / "Suchkuerzel-Transfer.command",
)
TRANSFER_FILE = next((path for path in transfer_candidates if path.is_file()), transfer_candidates[0])


def browser_roots() -> dict[str, dict[str, object]]:
    home = Path.home()
    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local"))
        roaming = Path(os.environ.get("APPDATA", home / "AppData/Roaming"))
        entries = {
            "chrome": ("Google Chrome", "chrome.exe", local / "Google/Chrome/User Data", "chrome://settings/search"),
            "brave": ("Brave", "brave.exe", local / "BraveSoftware/Brave-Browser/User Data", "brave://settings/search"),
            "edge": ("Microsoft Edge", "msedge.exe", local / "Microsoft/Edge/User Data", "edge://settings/search"),
            "vivaldi": ("Vivaldi", "vivaldi.exe", local / "Vivaldi/User Data", "vivaldi://settings/search"),
            "chromium": ("Chromium", "chrome.exe", local / "Chromium/User Data", "chrome://settings/search"),
        }
    elif sys.platform == "darwin":
        support = home / "Library/Application Support"
        entries = {
            "chrome": ("Google Chrome", "Google Chrome", support / "Google/Chrome", "chrome://settings/search"),
            "brave": ("Brave", "Brave Browser", support / "BraveSoftware/Brave-Browser", "brave://settings/search"),
            "edge": ("Microsoft Edge", "Microsoft Edge", support / "Microsoft Edge", "edge://settings/search"),
            "vivaldi": ("Vivaldi", "Vivaldi", support / "Vivaldi", "vivaldi://settings/search"),
            "chromium": ("Chromium", "Chromium", support / "Chromium", "chrome://settings/search"),
            "ego-lite": ("Ego Lite", "ego lite", support / "Citro Labs/ego lite", "chrome://settings/search"),
        }
    else:
        config = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
        entries = {
            "chrome": ("Google Chrome", "chrome", config / "google-chrome", "chrome://settings/search"),
            "brave": ("Brave", "brave", config / "BraveSoftware/Brave-Browser", "brave://settings/search"),
            "edge": ("Microsoft Edge", "msedge", config / "microsoft-edge", "edge://settings/search"),
            "vivaldi": ("Vivaldi", "vivaldi", config / "vivaldi", "vivaldi://settings/search"),
            "chromium": ("Chromium", "chromium", config / "chromium", "chrome://settings/search"),
            "chromium-snap": ("Chromium (Snap)", "chromium", home / "snap/chromium/common/chromium", "chrome://settings/search"),
        }
    return {
        key: {"label": label, "process": process, "root": path, "settings": settings}
        for key, (label, process, path, settings) in entries.items()
    }


def process_is_running(executable: str) -> bool:
    if sys.platform == "win32":
        result = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {executable}", "/NH"], capture_output=True, text=True)
        return executable.casefold() in result.stdout.casefold()
    if sys.platform == "darwin":
        return subprocess.run(["pgrep", "-f", executable], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    proc = Path("/proc")
    if proc.is_dir():
        for entry in proc.iterdir():
            if entry.name.isdigit():
                try:
                    if executable.casefold() in (entry / "comm").read_text().casefold():
                        return True
                except OSError:
                    continue
        return False
    return subprocess.run(["pgrep", "-f", executable], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def load_transfer():
    loader = importlib.machinery.SourceFileLoader("suchkuerzel_transfer_core", str(TRANSFER_FILE))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    if spec is None:
        raise RuntimeError("Die Transferlogik konnte nicht geladen werden.")
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    module.BROWSERS = browser_roots()
    module.BACKUP_DIR = Path.home() / "Documents" / "Suchkuerzel-Backups"
    original_wait_until_import_ready = module.wait_until_import_ready
    module.wait_until_import_ready = lambda profile, require_closed: original_wait_until_import_ready(profile, require_closed=True)

    def choose_from_list(title: str, prompt: str, choices: list[str]) -> str:
        choice, accepted = QInputDialog.getItem(None, title, prompt, choices, 0, False)
        if not accepted:
            raise module.Cancelled
        return choice

    def choose_manual_profile():
        browser_labels = [str(item["label"]) for item in module.BROWSERS.values()]
        browser_label, accepted = QInputDialog.getItem(None, "Browser auswählen", "Zu welchem Browser gehört das Profil?", browser_labels, 0, False)
        if not accepted:
            raise module.Cancelled
        browser_key = next(key for key, item in module.BROWSERS.items() if item["label"] == browser_label)
        directory = QFileDialog.getExistingDirectory(None, "Browser-Profilordner auswählen", str(Path.home()))
        if not directory:
            raise module.Cancelled
        profile_dir = Path(directory)
        database = profile_dir / "Web Data"
        if not database.is_file():
            raise module.TransferError("Der ausgewählte Ordner enthält keine Chromium-Suchdatenbank („Web Data“). Bitte direkt den Ordner Default oder Profile N auswählen.")
        count = len(module.read_shortcuts(database))
        return {"token": f"{browser_key}:{profile_dir}", "browser_key": browser_key, "label": f"{browser_label} — {module.profile_name(profile_dir)}", "directory": profile_dir, "path": database, "count": count}

    def choose_profile(profiles, purpose: str):
        labels = [f"{item['label']} — {item['count']} Kürzel" for item in profiles]
        manual = "Profilordner manuell auswählen …"
        choice, accepted = QInputDialog.getItem(None, "Suchkürzel-Transfer", purpose, labels + [manual], 0, False)
        if not accepted:
            raise module.Cancelled
        if choice != manual:
            return profiles[labels.index(choice)]
        return choose_manual_profile()

    def choose_source_profile(profiles):
        labels = [f"{item['label']} — {item['count']} Kürzel" for item in profiles]
        actions = [
            "Profilordner manuell auswählen …",
            "Aus XML-Datei importieren …",
            "Sicherung wiederherstellen …",
        ]
        choice, accepted = QInputDialog.getItem(
            None,
            "Suchkürzel-Transfer",
            "Quell-Browserprofil auswählen:",
            labels + actions,
            0,
            False,
        )
        if not accepted:
            raise module.Cancelled
        if choice in labels:
            return "profile", profiles[labels.index(choice)]
        return choice, None

    def choose_target(profiles, source):
        source_token = str(source.get("token"))
        candidate_profiles = [
            p for p in profiles if str(p.get("token")) != source_token and p.get("path") != source.get("path")
        ]
        labels = [f"{item['label']} — {item['count']} Kürzel" for item in candidate_profiles]
        options = [
            "Firefox (Lesezeichen-HTML)",
            "Als XML exportieren",
            "Profilordner manuell auswählen …",
        ]
        choice, accepted = QInputDialog.getItem(
            None,
            "Suchkürzel-Transfer",
            "Ziel für die Suchkürzel auswählen:",
            labels + options,
            0,
            False,
        )
        if not accepted:
            raise module.Cancelled
        if choice in labels:
            return "profile", candidate_profiles[labels.index(choice)]
        return choice, None

    def choose_browser(profiles, purpose: str, allow_firefox: bool = False) -> str:
        keys = list(dict.fromkeys(str(profile["browser_key"]) for profile in profiles))
        choices = [
            f"{module.BROWSERS[key]['label']} ({sum(profile['browser_key'] == key for profile in profiles)} {'Profil' if sum(profile['browser_key'] == key for profile in profiles) == 1 else 'Profile'})"
            for key in keys
        ]
        if allow_firefox:
            keys.append("firefox")
            choices.append("Firefox (Lesezeichen-HTML)")
        picked = choose_from_list("Suchkürzel-Transfer", purpose, choices)
        return keys[choices.index(picked)]

    def choose_browser_profile(profiles, browser_key: str, purpose: str):
        matching = [profile for profile in profiles if profile["browser_key"] == browser_key]
        if not matching:
            raise module.TransferError(f"Für {module.BROWSERS[browser_key]['label']} wurde kein zugängliches Profil gefunden.")
        if len(matching) == 1:
            return matching[0]
        return choose_profile(matching, purpose)

    def choose_save_path(default_name: str) -> Path:
        filename, _ = QFileDialog.getSaveFileName(None, "XML-Export speichern", str(Path.home() / default_name), "Suchkürzel-XML (*.xml)")
        if not filename:
            raise module.Cancelled
        path = Path(filename)
        return path if path.suffix.lower() == ".xml" else path.with_suffix(".xml")

    def choose_firefox_save_path(default_name: str) -> Path:
        filename, _ = QFileDialog.getSaveFileName(None, "Firefox-Importdatei speichern", str(Path.home() / default_name), "Firefox-Lesezeichen (*.html)")
        if not filename:
            raise module.Cancelled
        path = Path(filename)
        return path if path.suffix.lower() in {".html", ".htm"} else path.with_suffix(".html")

    def choose_xml_file() -> Path:
        filename, _ = QFileDialog.getOpenFileName(None, "Suchkürzel-XML auswählen", str(Path.home()), "Suchkürzel-XML (*.xml)")
        if not filename:
            raise module.Cancelled
        return Path(filename)

    def confirm(title: str, message: str, action: str) -> None:
        result = QMessageBox.question(None, title, message, QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.Cancel, QMessageBox.StandardButton.Cancel)
        if result != QMessageBox.StandardButton.Yes:
            raise module.Cancelled

    def alert(title: str, message: str, kind: str = "informational") -> None:
        box = QMessageBox()
        box.setWindowTitle(title)
        box.setText(message)
        box.setIcon(QMessageBox.Icon.Critical if kind == "error" else QMessageBox.Icon.Information)
        box.exec()

    def ask_retry_locked(label: str) -> None:
        result = QMessageBox.warning(None, "Browser schließen", f"{label} ist noch geöffnet.\n\nBitte vollständig beenden und erneut prüfen.", QMessageBox.StandardButton.Retry | QMessageBox.StandardButton.Cancel, QMessageBox.StandardButton.Retry)
        if result != QMessageBox.StandardButton.Retry:
            raise module.Cancelled

    module.choose_from_list = choose_from_list
    module.choose_profile = choose_profile
    module.choose_source_profile = choose_source_profile
    module.choose_target = choose_target
    module.choose_save_path = choose_save_path
    module.choose_firefox_save_path = choose_firefox_save_path
    module.choose_xml_file = choose_xml_file
    module.confirm = confirm
    module.alert = alert
    module.ask_retry_locked = ask_retry_locked
    module.browser_running = lambda profile: process_is_running(module.BROWSERS[profile["browser_key"]]["process"])
    module.open_search_settings = lambda profile: QDesktopServices.openUrl(QUrl(module.BROWSERS[profile["browser_key"]]["settings"]))

    def export_xml_flow(source, entries) -> None:
        default_search = module.read_default_search(source) or module.choose_default_search(source)
        date = module.dt.date.today().isoformat()
        filename = f"Suchkuerzel-{module.safe_component(source['label'])}-{date}.xml"
        destination = choose_save_path(filename)
        destination.write_text(module.to_xml(entries, source["label"], default_search), encoding="utf-8")
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(destination.parent)))
        alert(
            "XML-Export abgeschlossen",
            f"Von {source['label']} exportiert:\n{len(entries)} Suchkürzel gespeichert\n\n"
            f"Standardsuche: {default_search['short_name']} ({default_search['keyword']})\n\n"
            f"Datei:\n{destination}",
        )

    def export_firefox_flow(source, entries) -> None:
        filename = f"Firefox-Suchkuerzel-{module.safe_component(source['label'])}-{module.dt.date.today().isoformat()}.html"
        destination = choose_firefox_save_path(filename)
        destination.write_text(module.to_firefox_html(entries, source["label"]), encoding="utf-8")
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(destination.parent)))
        alert(
            "Firefox-Importdatei erstellt",
            f"Von {source['label']} exportiert:\n{len(entries)} Suchkürzel\n\n"
            f"Datei: {destination}\n\n"
            "In Firefox die Lesezeichenverwaltung öffnen und „Lesezeichen von HTML importieren“ wählen.",
        )

    def firefox_export_flow(profiles) -> None:
        source = choose_profile(profiles, "Chrome-/Brave-Quellprofil für Firefox auswählen:")
        entries = module.read_shortcuts(source["path"])
        if not entries:
            raise module.TransferError("Dieses Profil enthält keine aktiven eigenen Suchkürzel.")
        export_firefox_flow(source, entries)

    def export_flow(profiles) -> None:
        source = choose_profile(profiles, "Quellprofil für den XML-Export auswählen:")
        entries = module.read_shortcuts(source["path"])
        if not entries:
            raise module.TransferError("Dieses Profil enthält keine aktiven eigenen Suchkürzel.")
        export_xml_flow(source, entries)

    def import_xml_flow(profiles) -> None:
        xml_path = choose_xml_file()
        entries, default_search = module.parse_transfer_xml(xml_path.read_text(encoding="utf-8"))
        target = choose_profile(profiles, "Zielprofil für den XML-Import auswählen:")
        entries = module.entries_for_import(target["path"], entries, default_search)
        result = module.preview(target["path"], entries)
        if result["conflicts"]:
            raise module.TransferError("Geschützte oder mehrdeutige Kürzel-Kollisionen: " + ", ".join(result["conflicts"][:5]))
        default_message = (
            f"\nStandardsuche: {default_search['short_name']} ({default_search['keyword']})\n"
            if default_search
            else "\nStandardsuche: nicht in dieser XML enthalten\n"
        )
        confirm(
            "Import bestätigen",
            f"Ziel: {target['label']}\n\n{result['added']} neu\n{result['updated']} zu aktualisieren\n"
            f"{result['unchanged']} unverändert\n{default_message}\n"
            "Nichts wird gelöscht. Vorher wird eine Sicherung des Zielprofils erstellt.",
            "Importieren",
        )
        module.wait_until_import_ready(target, require_closed=bool(default_search))
        final, backup_path = module.apply_import(target["path"], target["label"], entries)
        default_finish = (
            f"\n\nAls Nächstes öffnen sich die Browser-Einstellungen. Dort bitte „{default_search['short_name']}“ als Standardsuche auswählen."
            if default_search
            else ""
        )
        alert(
            "Import abgeschlossen",
            f"{final['added']} neu, {final['updated']} aktualisiert, {final['unchanged']} unverändert.\n\n"
            f"Sicherung:\n{backup_path}{default_finish}",
        )
        if default_search:
            module.open_search_settings(target)

    def restore_flow(profiles) -> None:
        target = choose_profile(profiles, "Zielprofil für die Wiederherstellung auswählen:")
        filename, _ = QFileDialog.getOpenFileName(None, "Suchkürzel-Sicherung auswählen", str(module.BACKUP_DIR), "SQLite-Sicherung (*.sqlite)")
        if not filename:
            raise module.Cancelled
        backup_path = Path(filename)
        try:
            entries = module.read_shortcuts(backup_path)
        except (OSError, sqlite3.Error, module.TransferError) as error:
            raise module.TransferError("Die ausgewählte Datei ist keine lesbare Suchkürzel-Sicherung.") from error
        if not entries:
            raise module.TransferError("Die Sicherung enthält keine eigenen Suchkürzel.")
        result = module.preview(target["path"], entries)
        if result["conflicts"]:
            raise module.TransferError("Geschützte oder doppelte Kürzel kollidieren: " + ", ".join(result["conflicts"][:5]))
        confirm(
            "Sicherung wiederherstellen",
            f"Ziel: {target['label']}\nSicherung: {backup_path.name}\n\n{result['added']} neu\n{result['updated']} werden zurückgesetzt\n{result['unchanged']} unverändert\n\nAndere Profil- und Browserdaten bleiben unberührt.",
            "Wiederherstellen",
        )
        module.wait_until_import_ready(target, require_closed=True)
        final, current_backup = module.apply_import(target["path"], target["label"], entries)
        alert(
            "Wiederherstellung abgeschlossen",
            f"{final['added']} neu, {final['updated']} zurückgesetzt, {final['unchanged']} unverändert.\n\nSicherung des vorherigen Stands:\n{current_backup}",
        )

    def direct_transfer_flow(profiles) -> None:
        source_kind, source = choose_source_profile(profiles)
        if source_kind == "Profilordner manuell auswählen …":
            source = choose_manual_profile()
        elif source_kind == "Aus XML-Datei importieren …":
            import_xml_flow(profiles)
            return
        elif source_kind == "Sicherung wiederherstellen …":
            restore_flow(profiles)
            return

        entries = module.read_shortcuts(source["path"])
        if not entries:
            raise module.TransferError(f"Im Quellprofil {source['label']} gibt es keine eigenen Suchkürzel.")

        target_kind, target = choose_target(profiles, source)
        if target_kind == "Firefox (Lesezeichen-HTML)":
            export_firefox_flow(source, entries)
            return
        elif target_kind == "Als XML exportieren":
            export_xml_flow(source, entries)
            return
        elif target_kind == "Profilordner manuell auswählen …":
            target = choose_manual_profile()
            if target["path"] == source["path"]:
                raise module.TransferError("Quell- und Zielprofil dürfen nicht identisch sein.")

        # Standardsuche nur übernehmen, wenn die Quelle überhaupt eine hat. Sonst bleibt die
        # Standardsuche des Zielprofils unangetastet, statt eine erfundene einzutragen.
        default_search = module.read_default_search(source)
        import_entries = module.entries_for_import(target["path"], entries, default_search)
        result = module.preview(target["path"], import_entries)
        if result["conflicts"]:
            raise module.TransferError("Geschützte oder mehrdeutige Kürzel-Kollisionen: " + ", ".join(result["conflicts"][:5]))

        default_info = (
            f"\nStandardsuche: {default_search['short_name']} ({default_search['keyword']})\n"
            if default_search
            else ""
        )
        confirm(
            "Übertragung bestätigen",
            f"Von: {source['label']}\nNach: {target['label']}\n\n"
            f"{result['added']} neu\n{result['updated']} aktualisiert\n"
            f"{result['unchanged']} unverändert{default_info}\n\n"
            "Nichts wird gelöscht. Vorher wird eine Sicherung des Zielprofils erstellt.",
            "Übertragen",
        )
        module.wait_until_import_ready(target, require_closed=True)
        final, backup_path = module.apply_import(target["path"], target["label"], import_entries)
        default_note = (
            f"\n\nÖffne im Zielbrowser die Sucheinstellungen und wähle dort „{default_search['short_name']}“ als Standardsuche."
            if default_search
            else ""
        )
        alert(
            "Übertragung abgeschlossen",
            f"Von {source['label']} nach {target['label']} übertragen:\n"
            f"{final['added']} neu, {final['updated']} aktualisiert, {final['unchanged']} unverändert.\n\n"
            f"Sicherung des Zielprofils:\n{backup_path}{default_note}",
        )
        if default_search:
            module.open_search_settings(target)

    def app_main() -> int:
        try:
            profiles = module.discover_profiles()
            if module.DISCOVERY_WARNINGS:
                settings_opened = False
                if sys.platform == "darwin":
                    settings_url = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
                    settings_opened = subprocess.run(
                        ["open", settings_url],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False,
                    ).returncode == 0
                settings_hint = (
                    "Falls „SuchkuerzelTransfer.app“ bereits in der Liste steht und aktiv ist:\n"
                    "Bitte den Eintrag mit „-“ entfernen und mit „+“ neu hinzufügen (macOS erfordert dies nach App-Updates), danach die App neu starten.\n\n"
                    "Alternativ: Du kannst Chrome- und Brave-Profile jederzeit direkt über „Profilordner manuell auswählen …“ anwählen."
                )
                QMessageBox.warning(
                    None,
                    "Browserzugriff eingeschränkt",
                    "Einige Browserprofile sind für diese App durch macOS gesperrt und wurden übersprungen.\n\n"
                    + "\n".join(module.DISCOVERY_WARNINGS)
                    + "\n\n"
                    + settings_hint,
                )
            direct_transfer_flow(profiles)
            return 0
        except module.Cancelled:
            return 0
        except Exception as error:
            try:
                alert("Suchkürzel-Transfer", str(error), "error")
            except module.Cancelled:
                pass
            return 1

    module.main = app_main
    return module


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("Suchkürzel-Transfer")
    app.setOrganizationName("Suchkürzel-Transfer")
    try:
        transfer = load_transfer()
        if "--self-test" in sys.argv:
            transfer.self_test()
            return 0
        return transfer.main()
    except Exception as error:
        if "--self-test" in sys.argv:
            print(f"Selbsttest fehlgeschlagen: {type(error).__name__}: {error}", file=sys.stderr)
            return 1
        QMessageBox.critical(None, "Suchkürzel-Transfer", str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
