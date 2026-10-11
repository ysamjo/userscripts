# Suchkürzel-Transfer

Desktop-App zum Sichern und Übertragen eigener Suchkürzel in Chromium-Browsern. Die Daten bleiben auf dem Rechner. Die Oberfläche und Profil-Erkennung laufen unter Windows, macOS und Linux.

## Unterstützte Browser

- Google Chrome, Brave, Microsoft Edge, Vivaldi und Chromium auf Windows, macOS und Linux
- Ego Lite auf macOS
- Firefox erhält Suchkürzel über eine exportierte Lesezeichen-HTML-Datei. Ein direkter Firefox-Datenbankimport wird nicht vorgenommen.

Die App erkennt übliche Profilordner automatisch. Über „Profilordner manuell auswählen“ lassen sich abweichende Installationspfade und Linux-Flatpak-Profile angeben; dazu den konkreten `Default`- oder `Profile N`-Ordner mit der Datei `Web Data` auswählen.

## Funktionen

- Quellbrowser und Zielbrowser auswählen und Suchkürzel direkt zwischen Chromium-Browsern übertragen
- Quellprofil und Zielprofil auswählen, wenn ein Browser mehrere Profile enthält
- Vor dem Import Änderungen und Konflikte anzeigen
- Vor einem Schreibzugriff die Browserdatenbank sichern
- Bestehende Kürzel aktualisieren, neue hinzufügen und nichts löschen
- Suchkürzel für Firefox als HTML-Lesezeichen exportieren
- Profile über den üblichen Browserpfad erkennen oder manuell auswählen
- Standardsuche aus der Quelle in der Zielprofil-Datenbank verfügbar machen; die Auswahl als Standardsuche bestätigt der Nutzer anschließend im Browser

Der Zielbrowser muss für den Import vollständig beendet sein. Das Programm bricht bei geschützten oder mehrdeutigen Kürzel-Kollisionen ab. Backups liegen unter `Documents/Suchkuerzel-Backups`.

### macOS: Zugriff auf Browserprofile

macOS vergibt den Profilzugriff pro App. Wenn ein Browserordner wie Brave gesperrt ist, öffnet die App beim Start automatisch **Systemeinstellungen → Datenschutz & Sicherheit → Festplattenvollzugriff**. Füge dort `SuchkuerzelTransfer.app` hinzu und starte die App danach neu. Zugängliche Profile bleiben währenddessen auswählbar.

## Start aus dem Quellcode

Python 3.11 oder neuer wird benötigt.

```bash
cd app
python -m venv .venv
```

macOS/Linux:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
python main.py
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python main.py
```

## Eigenständige Pakete bauen

PyInstaller muss auf dem jeweiligen Zielbetriebssystem ausgeführt werden. Auf jedem System im `app`-Ordner:

```bash
python -m pip install -r requirements.txt
pyinstaller --noconfirm --clean SuchkuerzelTransfer.spec
```

Das Paket liegt danach in `dist/`. Die GitHub-Aktion baut getrennte Pakete auf Windows, macOS und Ubuntu und führt dabei den vorhandenen Kern-Selbsttest aus. macOS-Signierung/Notarisierung und Windows-Signierung sind für eine öffentliche Verteilung separat einzurichten.

## Datenformat und Grenzen

Das XML-Format der App bleibt mit dem bisherigen `Suchkuerzel-Transfer.command` kompatibel. SQLite-Backups werden vor Änderungen erstellt. Die App ersetzt keine Systemeinstellung für die Standardsuche: Chromium-Browser verlangen dafür eine Bestätigung in ihren Einstellungen. Flatpak-Sandboxen können den Zugriff auf Browserprofile verhindern; in diesem Fall muss die App mit passendem Profilzugriff gestartet oder ein XML-Transfer verwendet werden.
