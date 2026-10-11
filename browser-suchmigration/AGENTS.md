# Browser-Suchmigration

Lokale Werkzeuge zum Übertragen benutzerdefinierter Suchmaschinen und Suchkürzel zwischen Chromium-Profilen. Die Desktop-App in `app/` lässt Quellbrowser, Zielbrowser und bei Bedarf die Profile direkt auswählen; sie nutzt PySide6 und bindet die vorhandene Transferlogik aus `Suchkuerzel-Transfer.command` ein. Die übrigen Skripte sind bestehende macOS-Werkzeuge.

## Grenzen

- Browserprofil-Daten bleiben lokal. Nie ein gesamtes Profil ersetzen.
- Vor jedem Import oder Wiederherstellen in der Desktop-App Browserbeendigung prüfen, Änderungen bestätigen lassen und eine SQLite-Sicherung anlegen.
- Nicht zugängliche Browserprofilordner bei der automatischen Suche überspringen und im UI melden, damit andere Browserprofile weiter nutzbar bleiben.
- Beim Wiederherstellen nur eigene Suchkürzel ändern; Browser- und andere Profiltabellen unverändert lassen.
- Exportformat in der bestehenden Transferdatei kompatibel halten. Standard-Suchmaschinen-Einstellung muss der Nutzer im Browser bestätigen.
- Keine Zugangsdaten oder Browserinhalte außerhalb der Suchmaschinendaten erfassen.

## App-Befehle

Im Verzeichnis `app/`:

```bash
python -m venv .venv
python -m pip install -r requirements.txt
python main.py
python main.py --self-test
pyinstaller --noconfirm --clean SuchkuerzelTransfer.spec
```

Pakete für Windows, macOS und Linux jeweils auf dem Zielsystem bauen. Der GitHub-Workflow erledigt das für alle drei Systeme und führt den Kern-Selbsttest aus.
