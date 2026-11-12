# SendPilot – Chrome-Extension für Paketmaße

Führt die beiden Userscripte **Paketda** und **Klick-n-Schick** in einer Chrome-Extension (Manifest V3) zusammen.
Maße & Gewicht werden einmal eingetippt und landen per Toolbar-Popup direkt im Preisvergleich und in den
Versand-Portalen.

## Kernfunktionen

1. **Toolbar-Popup mit Maß-Eingabe** (L × B × H + Gewicht), Presets, Verlauf und Live-Kennzahlen:
   Gurtmaß, Volumengewicht, Frachtgewicht, Brief-Klasse (Standard-/Groß-/Maxibrief).
2. **Ein Klick zu Paketda**: `https://www.paketda.de/paket-preis-rechner.php?laenge=…&breite=…&hoehe=…&gewicht=…`
   – die Werte sind dort vorausgefüllt, das Userscript-Verhalten (Klick-n-Schick-Angebot, Packlink-Richtpreis,
   Novapost-Rabatt, Buttons, Adblock-Entferner) läuft als Content-Script weiter.
3. **Klick-n-Schick PowerTools** als Content-Script: PDF-Zuschnitt/Zentrierung, LEGO-Presets, Sperrgut = Nein,
   eBay-Auto-Import, DPD-Vorauswahl, Adress-/Tracking-Kopierer, Warenkorb → Kasse.
4. **Weitere Paketdienste** mit einem Klick: Packlink, DHL Online-Porto, Hermes, DPD, GLS, UPS, Deutsche Post.
   Wo Portale keine URL-Parameter akzeptieren, wird die Seite geöffnet und die Maße bleiben in der Zwischenablage
   bzw. im Verlauf verfügbar.
5. **DHL-Autofill**: Auf `dhl.de/…/online-frankieren.html` werden Maße & Gewicht aus SendPilot automatisch in die
   Formularfelder eingetragen (native Inputs + Events, damit React sie übernimmt), sobald sie im Versand-Schritt
   erscheinen. Füllt nie belegte Felder, ignoriert E-Mail/Adresse/IBAN, meldet gefüllte Felder per Badge.
6. **eBay-Übergabe**: Auf der eBay-Verkaufsdetailseite blendet SendPilot eine Leiste ein, die Käuferadresse,
   Artikelnummer und Bestellnummer erfasst. Der Verkauf wird gespeichert, im Popup übernommen (Maße als Entwurf +
   Adresse in die Zwischenablage) oder als Hermes-CSV-Zeile kopiert.
7. **eBay-API (Sell Fulfillment)**: Mit eigenem eBay-Entwickler-Keyset holt SendPilot offene Verkäufe direkt
   per API – ohne Adresskopieren. Einrichtung in *Einstellungen → eBay-API*.

### eBay-Import über die API

Statt die Adresse auf der Verkaufsseite abzulesen (Login nötig, nur was die Seite zeigt), kann SendPilot die
Bestellungen über die offizielle **Sell Fulfillment API** lesen. Dafür wird ein eBay-Entwickler-Keyset benötigt.

**Warum die Einrichtung etwas anders läuft als bei anderen OAuth-Anbietern:**

- eBay erwartet als `redirect_uri` keine URL, sondern eine **RuName** (Redirect-URL-Name).
- Als *Auth accepted URL* der RuName akzeptiert eBay **kein** `http://localhost` und kein HTTP – nur HTTPS.
- Chrome-Extensions können für `chrome.identity.launchWebAuthFlow` die Adresse
  `https://<extension-id>.chromiumapp.org/` nutzen. Diese wird von Chrome **intern abgefangen** und nie
  über das Netzwerk aufgerufen. Genau diese Adresse wird in die RuName eingetragen.

**Einrichtung (einmalig):**

1. `developer.ebay.com/my/keys` → Produktions-Keyset. **App ID** = Client-ID, **Cert ID** = Client-Secret.
2. *User Tokens* → *Add eBay Redirect URL* → RuName übernehmen.
3. Als *Auth accepted URL* die in den Einstellungen angezeigte `chromiumapp.org`-Adresse eintragen,
   *OAuth Enabled* ankreuzen, speichern.
4. Scope `sell.fulfillment.readonly` für das Keyset freischalten.
5. Werte in *Einstellungen → eBay-API* eintragen → **Speichern** → **Verbinden** → **Bestellungen laden**.

**Haltbarkeit der Tokens:**

| Token | Laufzeit | Erneuerung |
| --- | --- | --- |
| Access-Token | 2 Stunden | automatisch 60 s vor Ablauf |
| Refresh-Token | ~18 Monate | still im Hintergrund, kein erneutes Login |

Ein neues Login ist nur nötig, wenn der Refresh-Token abläuft oder das eBay-Passwort geändert wird.

**Grenzen:**

- eBay liefert `getOrders` nur für die **letzten 90 Tage**.
- Nur **eigene** Verkäufe (der autorisierte Account), kein Käufer-Konto.
- Client-Secret und Refresh-Token liegen ausschließlich in `chrome.storage.local` (nicht `sync`), das Secret
  wird nie geloggt und nie in einer URL übergeben.
- Ohne eingerichtete API funktioniert die Extension vollständig weiter – die eBay-Seiten-Leiste bleibt der Fallback.

### eBay-Import in Klick-n-Schick und Hermes

Klick-n-Schick **und Hermes** haben einen eigenen eBay-Adressimport im Konto (`/portal/ebayimport` bzw.
`/meinkonto/ebayimport`). Beide brauchen Login. DHL und Novapost bieten **keinen** eBay-Import für Privatkunden an –
dort ist die Übergabe über die eBay-Seite bzw. die API der Weg.

## Installation (ladenentpackt)

1. `chrome://extensions` → **Entwicklermodus** aktivieren.
2. **Entpackte Erweiterung laden** → Ordner `sendpilot/` wählen.
3. Optional die alten Tampermonkey-Skripte für `paketda.de` und `klick-n-schick.com/portal` deaktivieren –
   die Extension bringt dieselbe Logik mit (das Klick-n-Schick-Skript erkennt Doppel-Injektion).

Shortcut fürs Popup: `Alt+Shift+P` (änderbar unter `chrome://extensions/shortcuts`).

## Struktur

| Datei | Zweck |
| --- | --- |
| `manifest.json` | MV3-Manifest, Content-Scripts, Popup, Optionsseite, Shortcut |
| `src/background.js` | Service Worker: Tabs öffnen, Verlauf, URL-Bau |
| `src/paketda.js` | Port des Paketda-Userscripts v2.4 |
| `src/klick-n-schick.js` | Port der Klick-n-Schick PowerTools v1.3.0 (aus `*.part1.js` + `*.part2.js` gebaut) |
| `popup/*` | Popup (Eingabe, Anbieter, Verlauf) und Optionsseite (Settings, Live-Rechner) |
| `popup/lib.js` | Geteilte Rechen-/URL-Logik (auch von Tests genutzt) |
| `popup/ebay-api.js` | eBay OAuth + Sell Fulfillment API (getOrders) |
| `tools/make-icons.py` | erzeugt `icons/*.png` ohne externe Abhängigkeiten |
| `tools/build.py` | baut `dist/sendpilot-<version>.zip` |
| `tests/lib.test.js` | Selbsttests der Rechen-/URL-Logik (`node tests/lib.test.js`) |

## Unterschiede zur Userscript-Fassung

- `GM_*`-APIs → `chrome.storage` (Einstellungen in `sync`, Verlauf/Zugangsdaten in `local`).
- `pdf-lib` wird erst beim Zuschneiden geladen (kein `@require` beim Seitenstart).
- Maß-Übernahme via URL-Parameter funktioniert unverändert; zusätzlich meldet das Content-Script
  benutzte Pakete an den Verlauf.
- Das schwebende Einstellungs-Panel von Klick-n-Schick ist standardmäßig aus (Settings liegen jetzt in der
  Optionsseite); per `showPanel` wieder aktivierbar.

## Bauen und prüfen

```bash
node tests/lib.test.js      # Logik-Tests
python3 tools/make-icons.py # Icons neu erzeugen
python3 tools/build.py      # ZIP für den Store
```

## Grenzen

- `myhermes.de`, `dpd.com`, `gls-group.com`, `ups.com` nehmen Maße **nicht** per URL entgegen –
  dort wird nur das Portal geöffnet (Maße stehen im Verlauf bereit).
- DHL-Autofill hängt an den aktuellen Feldnamen von `dhl.de` (React); ändert DHL sie, füllt SendPilot nichts statt falsch.
- Der Hermes-eBay-Import liegt hinter der Login-Wall – SendPilot übernimmt die Adresse deshalb über die eBay-Seite
  (kopieren bzw. als CSV-Zeile bereitstellen).
- Chrome zeigt bei aktivem Popup immer das Popup; „Direkt zu Paketda“ gilt für Shortcut und Buttons auf den Seiten.
- Das Zuschneiden der Paketscheine lädt pdf-lib von jsDelivr (einmalig, danach aus dem Cache).
