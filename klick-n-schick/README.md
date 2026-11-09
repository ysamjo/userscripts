# Klick-n-Schick PowerTools

Tampermonkey / Violentmonkey Userscript zur Optimierung und Automatisierung von [klick-n-schick.com/portal](https://www.klick-n-schick.com/portal/).

---

## Enthaltene Funktionen

1. **Login speichern & Auto-Fill / Auto-Login**:
   - Ergänzt Standard-Attribute (`autocomplete="username"`, `autocomplete="current-password"`), damit moderne Browser und Passwort-Manager Zugangsdaten zuverlässig speichern können.
   - Integriert eine optionale Speicherfunktion im Userscript (`Zugangsdaten merken`) mit automatischem Ausfüllen und Auto-Login.
2. **Sperrgut standardmäßig anhaken**:
   - Im Packstück-Popup (`addpackstueck.aspx` und `addpackstueckebay.aspx`) wird die Option Sperrgut automatisch auf **„ja“** gesetzt (`rbSperrgutYes`).
   - Auch in dynamischen Listen und Zusatzleistungen wird Sperrgut automatisch vorausgewählt.
3. **Maße (Länge, Breite, Höhe, Gewicht) aus URL-Parametern**:
   - Unterstützt Übergabe via URL, z. B.:  
     `https://www.klick-n-schick.com/portal/paketschein/paketversand?laenge=60&breite=30&hoehe=15&gewicht=2`  
     (unterstützt auch Kurzformen wie `l`, `b`, `h`, `g`).
   - Reicht die Parameter nahtlos an die Packstück-Popups und eBay-Packstückzeilen durch und stößt die automatische Gurtmaß-Berechnung (`tryCalc`) an.
4. **eBay automatisch importieren**:
   - Ruft auf `/portal/ebayimport` beim Öffnen der Seite automatisch die Datenaktualisierung (`btnImport`) ab (mit Session-Loop-Schutz).
5. **Warenkorb direkt zur Kasse weiterleiten**:
   - Leitet auf `/portal/warenkorb` (bzw. `payment.aspx`), sobald Packstücke im Warenkorb liegen, nach kurzer optischer Countdown-Vorschau direkt zur Kasse weiter (mit Abbrechen-Button und Schutz vor Weiterleitungsschleifen).
6. **Komfort-Zusätze**:
   - Automatisches Akzeptieren des Cookie-Banners.
   - Automatisches Bestätigen der AGB & Verpackungsleitlinien-Checkbox (`cbAGB`).
   - Dezentes Floating-Bedienfeld unten links zur Konfiguration einzelner Module.

---

## Installation

### Variante A: Lokaler Loader (für Entwickler, empfohlen)
1. Neues Userscript in Tampermonkey / Violentmonkey anlegen.
2. Inhalt von [`Klick-n-Schick lokaler Loader.user.js`](./Klick-n-Schick%20lokaler%20Loader.user.js) hineinkopieren.
3. Änderungen in `Klick-n-Schick.user.js` sind sofort im Browser aktiv, ohne das Userscript neu installieren zu müssen.

### Variante B: Direktinstallation
1. Datei [`Klick-n-Schick.user.js`](./Klick-n-Schick.user.js) öffnen.
2. In Tampermonkey importieren oder per Drag & Drop im Dashboard ablegen.
