# Userscripts

Dieses Repository ist die maßgebliche Quelle für die Userscripts. Tampermonkey lädt Updates über `raw.githubusercontent.com/ysamjo/userscripts/main/`.

## Einmalig einrichten

1. Auf jedem Rechner Tampermonkey installieren und die gewünschten Skripte über die Installationslinks unten hinzufügen.
2. Bei den bisherigen Installationen aus lokalen Dateien die Skripte einmal über die neuen Links ersetzen. Insbesondere **„lokaler Loader“**-Skripte entfernen: Sie verweisen auf einen lokalen `file:///Users/...`-Pfad und synchronisieren nicht zwischen Rechnern.
3. Tampermonkey-Einstellungen so setzen, dass automatische Updates aktiviert sind. Updates laufen von GitHub zu Tampermonkey; Änderungen im Tampermonkey-Editor werden **nicht** zurück ins Repository synchronisiert. Änderungen am Quellcode daher hier pflegen und nach `main` veröffentlichen.

## Installieren

- [Klick-n-Schick PowerTools](https://raw.githubusercontent.com/ysamjo/userscripts/main/klick-n-schick/Klick-n-Schick.user.js)
- [mydealz Werbebanner Blocker](https://raw.githubusercontent.com/ysamjo/userscripts/main/mydealz/mydealz%20Adblock.user.js)
- [Paketda Packlink Button & Adblock Remover](https://raw.githubusercontent.com/ysamjo/userscripts/main/paketda/Paketda.user.js)
- [Video Speed Control with Keyboard](https://raw.githubusercontent.com/ysamjo/userscripts/main/video-speed/Video%20Speed%20Control%20with%20Keyboard.user.js)
- [YouTube Tweaks](https://raw.githubusercontent.com/ysamjo/userscripts/main/youtube-tweaks/YouTube%20Tweaks.user.js)

Tampermonkey prüft Updates gemäß der eingestellten Update-Häufigkeit. Damit Änderungen auf anderen Rechnern ankommen, müssen sie in diesem Repository landen und auf `main` veröffentlicht werden.
