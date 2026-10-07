# Sichere Suchkürzel-Migration

Überträgt benutzerdefinierte Suchmaschinen und die Standardsuche zwischen Chromium-Browser-Profilen.

## Empfohlen: GUI-Version

**Doppelklick auf:**
```
Suchkuerzel-Migration.command
```

Oder im Terminal:
```bash
python3 sichere_suchkuerzel_migration_gui.py
```

Die GUI erkennt automatisch Chrome, Brave und Ego Lite.

## CLI-Version

```text
python3 sichere_suchkuerzel_migration.py --export ~/Desktop/suchkürzel.xml
python3 sichere_suchkuerzel_migration.py --import ~/Desktop/suchkürzel.xml
```

## Sicherheit

- Das Browserprofil wird niemals gelöscht, verschoben oder ersetzt.
- Vor einem Import werden `Preferences` und `Web Data` in `Search-Migration-Backups/<Zeitstempel>` gesichert.
- Bei laufendem Browser wird eine Warnung angezeigt – der Nutzer entscheidet, ob trotzdem fortgefahren wird. Änderungen wirken erst nach einem Neustart des Browsers.
- Browser-Ordner ohne Vollzugriff werden als „kein Zugriff" übersprungen statt abzubrechen.
- Beim Import werden nur Suchkürzel mit demselben Kürzel aktualisiert; andere Profildaten bleiben unverändert.

## Unterstützte Browser

| Browser | Profilpfad |
|---------|------------|
| Chrome | `~/Library/Application Support/Google/Chrome` |
| Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser` |
| Ego Lite | `~/Library/Application Support/Citro Labs/ego lite` |

## Bekannte Probleme

**PermissionError bei Chrome/Brave:**
- Ursache: macOS blockiert das Auflisten von `~/Library/Application Support/Google/Chrome`
  und `…/BraveSoftware/Brave-Browser` (TCC), wenn die aufrufende App keinen **Vollzugriff** hat.
- Lösung: Systemeinstellungen → Datenschutz & Sicherheit → Vollzugriff → Terminal (bzw. die
  App, die das Skript startet) aktivieren, Terminal neu starten, Skript erneut starten.
- Die Skripte zeigen betroffene Browser in der Liste als `… (kein Zugriff)` an,
  statt abzubrechen. Andere Browser bleiben nutzbar.

**Ego Lite:** Die Prozesssuche `pgrep -fl "ego lite"` erkennt auch laufende Renderer-Helfer.
Erscheint der Browser zu Unrecht als "läuft", hilft ein vollständiges Beenden über
`Cmd+Q` (nicht nur das Schließen des Fensters).
