// ==UserScript==
// @name         Klick-n-Schick PowerTools (lokaler Loader)
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Lädt das Klick-n-Schick PowerTools-Skript direkt aus dem lokalen Entwickler-Ordner (/Users/family/Developer/userscripts/klick-n-schick/Klick-n-Schick.user.js).
// @match        https://www.klick-n-schick.com/*
// @match        https://klick-n-schick.com/*
// @icon         https://www.klick-n-schick.com/portal/favicon.png
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// @require      file:///Users/family/Developer/userscripts/klick-n-schick/Klick-n-Schick.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      klick-n-schick.com
// @connect      www.klick-n-schick.com
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// @run-at       document-end
// ==/UserScript==

// Der eigentliche Code wird über @require aus der lokalen Datei geladen.
