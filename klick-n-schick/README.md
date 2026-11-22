# Klick-n-Schick PowerTools

Tampermonkey / Violentmonkey Userscript zur Optimierung und Automatisierung von [klick-n-schick.com/portal](https://www.klick-n-schick.com/portal/).

---

## Enthaltene Funktionen (v1.4.0)

1. **Dauerhafter Auto-Login & Session Keep-Alive (Nie wieder manuell anmelden!)**:
   - **Lückenloser Auto-Login**: Erkennt automatisch auf *jeder* Seite (`/portal/`, `meinepaketscheine.aspx`, etc.), wenn man abgemeldet ist, füllt die Zugangsdaten aus und loggt sich in < 0.5s automatisch ein.
   - **Intelligente Rückleitung**: Wer direkt eine Unterseite aufruft (z. B. Meine Paketscheine), wird nach dem Login automatisch genau dorthin zurückgeleitet.
   - **Session Keep-Alive**: Sendet alle 8 Minuten einen leichten Hintergrund-Ping, sodass die serverseitige 20-Minuten-ASP.NET-Sitzung niemals unbemerkt verfällt, solange ein Tab geöffnet ist.
   - **Cookie-Persistenz**: Verlängert funktionale Cookies und Session-Cookies automatisch via `GM_cookie` bzw. `document.cookie` auf 1 Jahr.
2. **Paketschein automatisch zuschneiden, zentrieren & drucken (Keynote-Workflow automatisiert)**:
   - **Rechte Seite abschneiden**: Entfernt automatisch die überflüssige Kundenquittung aus dem JasperReports-A4-Bogen.
   - **Auf DIN A4 zentrieren**: Zentriert das DPD-Paketlabel exakt in der Mitte der A4-Seite (genau wie bisher manuell in Keynote) – perfekt für Standard-Druckerpapier.
   - **1-Klick Direkt-Druck (`🖨️ Drucken`)**: Öffnet ohne Umwege direkt den Druckdialog für das beschnittene, zentrierte Label.
   - **1-Klick Downloads**:
     - `⬇ A4`: Zentriertes DIN A4 PDF herunterladen.
     - `🏷️ A6`: Reines DIN A6 Etikett (für Label- & Thermodrucker).
     - `Orig.`: Unbeschnittenes Original-PDF mit Quittung falls nötig.
   - **Top-Toolbar in `showfile.aspx`**: Sofortige Aktionsleiste beim Öffnen des Paketschein-Fensters (inkl. konfigurierbarem Sofort-Druck).
3. **Sperrgut standardmäßig auf NEIN**:
   - Verhindert teure Sperrgutzuschläge: Im Packstück-Popup (`addpackstueck.aspx` und `addpackstueckebay.aspx`) wird Sperrgut standardmäßig immer auf **„nein“** gesetzt (`rbSperrgutNo`).
4. **Keine abgeschnittenen Popups mehr**:
   - Die Höhe des Packstück-Modals wird automatisch auf min. 510 px vergrößert, sodass alle Eingabefelder und der Button „Packstück hinzufügen“ vollständig sichtbar sind.
5. **1-Klick LEGO RTS-Presets im Packstück-Popup**:
   - **Klein** (30 × 20 × 15 cm | 1.0 kg) — Speed Champions, kleine Sets.
   - **Mittel / AT-AT** (60 × 39 × 10 cm | 2.5 kg) — z. B. Star Wars AT-AT 75288 u. ä. (OVP ca. 58,2 × 37,8 × 8,7 cm).
   - **Groß / UCS** (59 × 49 × 18 cm | 5.0 kg) — Motorisierter Leuchtturm, Ideas-Klassiker.
   - **XL / Titanic** (60 × 50 × 39 cm | 12.0 kg) — LEGO Titanic, Millennium Falcon.
6. **Maße aus URL-Parametern**:
   - `?laenge=...&breite=...&hoehe=...&gewicht=...` werden automatisch übernommen.
7. **eBay automatisch importieren**:
   - `/portal/ebayimport` stößt den Datenabruf automatisch an.
8. **Immer DPD vorauswählen**:
   - Selektiert DPD automatisch in der Methodenliste.
9. **Paketschein-PDF Auto-Download**:
   - Startet den PDF-Download nach Bezahlung oder im `showfile`-Popup automatisch (wahlweise zentriert oder Original).
10. **1-Klick Adress- & Tracking-Kopierer**:
    - `📋` Adressen mehrzeilig sauber kopieren, `📋` Trackingnummern kopieren, `🔗` DPD Live-Tracking.
11. **Warenkorb direkt zur Kasse**:
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
