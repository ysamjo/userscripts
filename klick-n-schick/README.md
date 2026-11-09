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
3. **1-Klick Paket-Presets im Packstück-Popup**:
   - Schnellbuttons direkt über der Maße-Eingabe:
     - `S` (30×20×15 cm | 1 kg)
     - `M` (50×30×15 cm | 2 kg)
     - `L` (60×40×30 cm | 5 kg)
     - `Lego` (70×40×30 cm | 4 kg)
     - `Sperrgut` (120×60×60 cm | 10 kg)
   - Klick setzt Maße & Gewicht, berechnet Gurtmaß neu und behält Sperrgut auf „ja“.
4. **Maße (Länge, Breite, Höhe, Gewicht) aus URL-Parametern**:
   - Unterstützt Übergabe via URL, z. B.:  
     `https://www.klick-n-schick.com/portal/paketschein/paketversand?laenge=60&breite=30&hoehe=15&gewicht=2`  
     (unterstützt auch Kurzformen wie `l`, `b`, `h`, `g`).
   - Reicht die Parameter nahtlos an die Packstück-Popups und eBay-Packstückzeilen durch und stößt die automatische Gurtmaß-Berechnung (`tryCalc`) an.
   - Integriert mit [Paketda.user.js](../paketda/Paketda.user.js).
5. **eBay automatisch importieren**:
   - Ruft auf `/portal/ebayimport` beim Öffnen der Seite automatisch die Datenaktualisierung (`btnImport`) ab (mit Session-Loop-Schutz).
6. **Immer DPD als Versanddienstleister vorauswählen**:
   - Wählt in der Methodenliste auf `paketversand` und `ebayimport` automatisch die DPD-Option aus.
7. **Paketschein-PDF Auto-Download**:
   - Nach erfolgreicher Bestellung bzw. im `showfile.aspx`-Popup wird der Paketschein (PDF) automatisch als Download angestoßen.
8. **1-Klick Adress- & Tracking-Kopierer**:
   - **eBay-Import**: `📋`-Button neben jeder Käuferzeile formatiert Name, Straße, PLZ Ort und Land sauber mehrzeilig in die Zwischenablage.
   - **Meine Paketscheine**:
     - `📋` Kopiert die 14-stellige Sendungsnummer.
     - `🔗` Öffnet die Live-DPD-Sendungsverfolgung.
     - `⬇ PDF` Lädt das Label direkt ohne Iframe-Vorschau herunter.
9. **Warenkorb direkt zur Kasse weiterleiten**:
   - Leitet auf `/portal/warenkorb` (bzw. `payment.aspx`), sobald Packstücke im Warenkorb liegen, nach kurzer 2-Sekunden-Vorschau direkt zur Kasse weiter.
10. **Komfort-Zusätze**:
    - Automatisches Akzeptieren des Cookie-Banners.
    - Automatisches Bestätigen der AGB & Verpackungsleitlinien-Checkbox (`cbAGB`).
    - Dezentes Floating-Bedienfeld unten links zur Konfiguration aller Module.

---

## Installation

### Variante A: Lokaler Loader (für Entwickler, empfohlen)
1. Neues Userscript in Tampermonkey / Violentmonkey anlegen.
2. Inhalt von [`Klick-n-Schick lokaler Loader.user.js`](./Klick-n-Schick%20lokaler%20Loader.user.js) hineinkopieren.
3. Änderungen in `Klick-n-Schick.user.js` sind sofort im Browser aktiv, ohne das Userscript neu installieren zu müssen.

### Variante B: Direktinstallation
1. Datei [`Klick-n-Schick.user.js`](./Klick-n-Schick.user.js) öffnen.
2. In Tampermonkey importieren oder per Drag & Drop im Dashboard ablegen.
