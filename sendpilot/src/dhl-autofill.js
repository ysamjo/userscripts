/* SendPilot – Autofill für DHL Online-Frankierung
 *
 * DHL nimmt Maße nicht per URL entgegen. Dieses Content-Script trägt sie deshalb
 * direkt in die Formularfelder ein, sobald sie auf der Seite auftauchen.
 *
 * Vorgehen:
 *  - Paketdaten aus chrome.storage.local (zuletzt in SendPilot eingegeben)
 *  - MutationObserver, weil DHL eine React-SPA ist und Felder erst spät erscheinen
 *  - Werte werden wie echte Nutzereingaben gesetzt (native setter + Events),
 *    sonst ignoriert React sie
 *  - Füllt nur leere Felder, überschreibt nie Eingaben des Nutzers
 *  - Sichtbarer Hinweis, damit klar ist, wer die Werte gesetzt hat
 *
 * Bewusste Grenze: DHL ändert Feldnamen und Layout regelmäßig. Die Auswahl läuft
 * über mehrere Muster (name/id/aria-label/placeholder) und bricht still ab, wenn
 * nichts passt – statt falsche Felder zu füllen.
 */

(function () {
    'use strict';

    if (window.__sendPilotDhlLoaded) return;
    window.__sendPilotDhlLoaded = true;

    const STORAGE_KEY = 'sendpilot.draft';
    const FILLED_FLAG = 'sendpilot.dhl.filled';

    // --- 1. Feldmuster -----------------------------------------------------
    // Jedes Muster ist eine Liste von Regex, die gegen name/id/aria-label/placeholder
    // geprüft werden. Reihenfolge = Priorität.
    const FIELD_PATTERNS = {
        laenge: [/l(ae|ä)nge/i, /length/i, /dimension.*length/i, /\bdim_l\b/i],
        breite: [/breite/i, /width/i, /dimension.*width/i, /\bdim_w\b/i],
        hoehe: [/h(oe|ö)he/i, /height/i, /dimension.*height/i, /\bdim_h\b/i],
        gewicht: [/gewicht/i, /weight/i, /mass/i]
    };

    // Felder, die auf keinen Fall angefasst werden dürfen
    const FORBIDDEN = /(email|mail|passwort|password|iban|bic|konto|telefon|phone|plz|postcode|zip|ort|stadt|city|name|vorname|nachname|street|stra(ss|ß)e)/i;

    // --- 2. Werte setzen ---------------------------------------------------

    /**
     * Setzt einen Wert so, dass React ihn mitbekommt.
     * Ohne den native Setter bleibt der Wert im State leer.
     */
    function setNativeValue(element, value) {
        const proto = element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor?.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function withComma(value) {
        // Deutsche Formulare akzeptieren oft nur Komma
        return String(value).replace('.', ',');
    }

    function isVisibleAndEditable(element) {
        if (!element || element.disabled || element.readOnly) return false;
        if (element.type === 'hidden') return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return element.getBoundingClientRect().width > 0;
    }

    // --- 3. Felder finden --------------------------------------------------

    function describe(element) {
        return [
            element.name,
            element.id,
            element.getAttribute('aria-label'),
            element.getAttribute('placeholder'),
            element.getAttribute('data-testid'),
            element.closest('label')?.innerText,
            element.parentElement?.innerText
        ].filter(Boolean).join(' | ');
    }

    function findField(key) {
        const candidates = Array.from(document.querySelectorAll('input, select'))
            .filter(isVisibleAndEditable);

        for (const element of candidates) {
            const haystack = describe(element);
            if (!haystack || FORBIDDEN.test(haystack)) continue;
            const matches = FIELD_PATTERNS[key].some((pattern) => pattern.test(haystack));
            if (matches) return element;
        }
        return null;
    }

    function isEmpty(element) {
        if (element.tagName === 'SELECT') {
            return element.selectedIndex <= 0 || !element.value;
        }
        const value = element.value?.trim();
        return !value || value === '0' || value === '0,0' || value === '0.0';
    }

    // --- 4. Anzeige --------------------------------------------------------

    function showBadge(message, tone = 'ok') {
        let badge = document.getElementById('sp-dhl-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'sp-dhl-badge';
            badge.style.cssText = `
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483000;
                background: ${tone === 'ok' ? '#10b981' : '#f59e0b'};
                color: #fff;
                border-radius: 20px;
                padding: 7px 13px;
                font: 600 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 6px 18px rgba(16, 24, 40, 0.22);
                max-width: 300px;
            `;
            document.body.appendChild(badge);
            setTimeout(() => badge.remove(), 9000);
        }
        badge.textContent = message;
    }

    // --- 5. Ablauf ---------------------------------------------------------

    function fill(pkg) {
        if (!pkg || !pkg.laenge || !pkg.breite || !pkg.hoehe || !pkg.gewicht) return 0;

        const values = {};
        Object.keys(FIELD_PATTERNS).forEach((key) => {
            const field = findField(key);
            if (!field) return;
            const raw = pkg[key];
            if (!Number.isFinite(Number(raw)) || Number(raw) <= 0) return;
            if (!isEmpty(field)) return; // Nutzereingaben nie überschreiben
            if (field.tagName === 'SELECT') {
                const option = Array.from(field.options).find((opt) => opt.value === String(raw) || opt.textContent.trim() === String(raw));
                if (option) field.value = option.value;
                else return;
            } else {
                setNativeValue(field, withComma(raw));
            }
            values[key] = raw;
        });

        const filled = Object.keys(values);
        if (filled.length === 0) return 0;

        if (filled.length === 4) {
            showBadge(`✈ SendPilot: ${pkg.laenge} × ${pkg.breite} × ${pkg.hoehe} cm · ${pkg.gewicht} kg eingetragen`, 'ok');
        } else {
            showBadge(`✈ SendPilot: ${filled.length}/4 Felder gefüllt (${filled.join(', ')})`, 'warn');
        }
        return filled.length;
    }

    async function run() {
        if (sessionStorage.getItem(FILLED_FLAG) === 'true') return 4;

        let stored;
        try {
            stored = await chrome.storage.local.get(STORAGE_KEY);
        } catch (e) {
            return 0;
        }
        const pkg = stored?.[STORAGE_KEY]?.pkg;
        if (!pkg) return 0;

        const count = fill(pkg);
        if (count === 4) {
            sessionStorage.setItem(FILLED_FLAG, 'true');
        }
        return count;
    }

    // SPA: Felder erscheinen verzögert und nach jedem Schritt neu.
    // Der Observer bleibt aktiv, bis alle vier Felder einmal gefüllt wurden –
    // DHL fragt die Maße erst im Versand-Schritt ab, nicht auf der Startseite.
    let timer;
    let stopped = false;

    function stop() {
        if (stopped) return;
        stopped = true;
        observer.disconnect();
    }

    const observer = new MutationObserver(() => {
        if (stopped) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            run().then((count) => {
                if (count === 4) stop();
            });
        }, 400);
    });

    function start() {
        run().then((count) => {
            if (count === 4) return;
            observer.observe(document.body, { childList: true, subtree: true });
        });
        // Sicherheitsnetz: nach 10 Minuten Beobachtung beenden
        setTimeout(stop, 600000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
