# Browser-Suchmigration

Werkzeuge zum lokalen Übertragen und Sichern eigener Browser-Suchkürzel.

- [Suchkürzel-Transfer Desktop-App](app/README.md): Windows, macOS und Linux
- `Suchkuerzel-Transfer.command`: bisheriges macOS-Einzeldateiwerkzeug
- `Sicheres-Migrationsskript/`: bisherige macOS-GUI und CLI

Die neue Desktop-App verwendet dasselbe XML-Format wie `Suchkuerzel-Transfer.command`. Sie zeigt Änderungen vor dem Import an, erstellt vor dem Schreiben eine SQLite-Sicherung und ändert nur Suchkürzel. Änderungen an der Standardsuche müssen anschließend in den Browser-Einstellungen bestätigt werden.

Entwicklung und plattformspezifische Paketierung sind in [app/README.md](app/README.md) beschrieben. Das CI baut unter Windows, macOS und Ubuntu.
