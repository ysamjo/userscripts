# Sichere Suchkürzel-Migration

Das Skript überträgt benutzerdefinierte Suchmaschinen und die Standardsuche zwischen Chrome- und Brave-Profilen.

```text
python3 sichere_suchkuerzel_migration.py --export ~/Desktop/suchkürzel.xml
python3 sichere_suchkuerzel_migration.py --import ~/Desktop/suchkürzel.xml
```

Sicherheit:

- Das Browserprofil wird niemals gelöscht, verschoben oder ersetzt.
- Vor einem Import werden `Preferences` und `Web Data` in `Search-Migration-Backups/<Zeitstempel>` gesichert.
- Der Import wird abgebrochen, solange der Browser noch läuft.
- Beim Import werden nur Suchkürzel mit demselben Kürzel aktualisiert; andere Profildaten bleiben unverändert.
