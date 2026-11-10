# Klick-n-Schick PowerTools

Tampermonkey / Violentmonkey Userscript zur Optimierung und Automatisierung von [klick-n-schick.com/portal](https://www.klick-n-schick.com/portal/).

---

## Enthaltene Funktionen (v1.2.0)

1. **Sperrgut standardmäßig auf NEIN**:
   - Verhindert teure Sperrgutzuschläge: Im Packstück-Popup (`addpackstueck.aspx` und `addpackstueckebay.aspx`) wird Sperrgut standardmäßig immer auf **„nein“** gesetzt (`rbSperrgutNo`).
2. **Keine abgeschnittenen Popups mehr**:
   - Die Höhe des Packstück-Modals wird automatisch auf min. 510 px vergrößert, sodass alle Eingabefelder und der Button „Packstück hinzufügen“ vollständig sichtbar sind.
3. **1-Klick LEGO RTS-Presets im Packstück-Popup**:
   - **Klein** (30 × 20 × 15 cm | 1.0 kg) — Speed Champions, kleine Sets.
   - **Mittel / AT-AT** (60 × 39 × 10 cm | 2.5 kg) — z. B. Star Wars AT-AT 75288 u. ä. (OVP ca. 58,2 × 37,8 × 8,7 cm).
   - **Groß / UCS** (59 × 49 × 18 cm | 5.0 kg) — Motorisierter Leuchtturm, Ideas-Klassiker.
   - **XL / Titanic** (60 × 50 × 39 cm | 12.0 kg) — LEGO Titanic, Millennium Falcon.
4. **Login speichern & Auto-Fill / Auto-Login**:
   - Standard-HTML5-Attribute für Passwortmanager + optionale Userscript-Checkbox „Zugangsdaten merken“.
5. **Maße aus URL-Parametern**:
   - `?laenge=...&breite=...&hoehe=...&gewicht=...` werden automatisch übernommen.
6. **eBay automatisch importieren**:
   - `/portal/ebayimport` stößt den Datenabruf automatisch an.
7. **Immer DPD vorauswählen**:
   - Selektiert DPD automatisch in der Methodenliste.
8. **Paketschein-PDF Auto-Download**:
   - Startet den PDF-Download nach Bezahlung oder im `showfile`-Popup automatisch.
9. **1-Klick Adress- & Tracking-Kopierer**:
   - `📋` Adressen mehrzeilig sauber kopieren, `📋` Trackingnummern kopieren, `🔗` DPD Live-Tracking, `⬇ PDF` Direkt-Download.
10. **Warenkorb direkt zur Kasse**:
    - Leitet bei gefülltem Warenkorb nach 2 Sekunden weiter.

---

## Installation

### Variante A: Direkt in Tampermonkey einfügen (Empfohlen)
1. In Tampermonkey auf **Dashboard** → **+ (Neues Skript)**.
2. Alles markieren (`Cmd + A`) und einfügen (`Cmd + V` — Skript liegt in der Zwischenablage).
3. Speichern (`Cmd + S`).

### Variante B: Lokaler Loader
1. In `chrome://extensions` bei Tampermonkey unter **Details** die Option **„Zugriff auf Datei-URLs zulassen“** aktivieren.
2. In Tampermonkey [`Klick-n-Schick lokaler Loader.user.js`](./Klick-n-Schick%20lokaler%20Loader.user.js) verwenden.
