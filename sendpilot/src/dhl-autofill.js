/* SendPilot – Autofill für Versand-Formulare (DHL, Hermes, DPD)
 *
 * DHL, Hermes und DPD nehmen Maße nicht per URL entgegen. Dieses Content-Script
 * trägt sie deshalb direkt in die Formulare ein, sobald sie auftauchen.
 * (Der Dateiname stammt aus der DHL-only-Fassung; der Build lädt weiterhin
 * src/dhl-autofill.js.)
 *
 * Vorgehen:
 *  - Paketdaten aus chrome.storage.local (zuletzt in SendPilot eingegeben)
 *  - MutationObserver, weil alle drei Portale SPAs sind und Felder erst spät erscheinen
 *  - Werte werden wie echte Nutzereingaben gesetzt (native setter + Events),
 *    sonst ignorieren React & Co. sie
 *  - Füllt nur leere Felder, überschreibt nie Eingaben des Nutzers
 *  - Sichtbarer Hinweis, damit klar ist, wer die Werte gesetzt hat
 *
 * Hermes und DPD haben für Privatkunden keine cm-Felder: Sie rechnen mit
 * "längste + kürzeste Seite" und verlangen eine Paketklasse. Dort wählt das
 * Script die kleinste passende Klasse im Radio-/Auswahlfeld (Logik in
 * popup/lib.js → parcelClass, damit sie testbar bleibt).
 *
 * Bewusste Grenze: Feldnamen und Layout ändern sich regelmäßig. Die Auswahl läuft
 * über mehrere Muster (name/id/aria-label/placeholder) und bricht still ab, wenn
 * nichts passt – statt falsche Felder zu füllen.
 */

(function () {
    'use strict';

    if (window.__sendPilotAutofillLoaded) return;
    window.__sendPilotAutofillLoaded = true;

    const STORAGE_KEY = 'sendpilot.draft';
    const FILLED_FLAG = 'sendpilot.autofill.filled';

    // --- 0. Formular pro Portal -------------------------------------------

    const SITES = [
        { id: 'dhl', host: /(^|\.)dhl\.de$/i, fields: true, classes: null },
        { id: 'hermes', host: /(^|\.)myhermes\.de$/i, fields: true, classes: 'hermes' },
        { id: 'dpd', host: /(^|\.)dpd(\.de|\.com)$/i, fields: true, classes: 'dpd' }
    ];

    const site = SITES.find((entry) => entry.host.test(location.hostname));
    if (!site) return;

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

    // Klassen-Werte wie im Formular von Hermes (HP, S, M, L) und DPD (XS–XL)
    const CLASS_IDS = new Set(['HP', 'XS', 'S', 'M', 'L', 'XL', 'XXL']);
    const CLASS_HINT = /(paketklasse|parcel\s*class|parcel.?size|size.?class|paketgr(oe|ö)(ss|ß)e|klasse)/i;

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

    function setSelectValue(element, value) {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
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

    // --- 3. Felder und Paketklasse finden ----------------------------------

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

    /**
     * Sucht die Paketklassen-Auswahl des Portals.
     * Radios werden nur akzeptiert, wenn die Gruppe mindestens drei Klassenwerte
     * hat – so bleiben Radio-Gruppen für Zustellart o. Ä. unangetastet.
     */
    function findClassControl() {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'))
            .filter(isVisibleAndEditable);
        const groups = new Map();
        radios.forEach((element) => {
            const key = element.name || element.getAttribute('form') || '__default';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(element);
        });

        for (const elements of groups.values()) {
            const ids = new Set(elements
                .map((element) => String(element.value).trim().toUpperCase())
                .filter((value) => CLASS_IDS.has(value)));
            if (ids.size >= 3) return { type: 'radio', elements };
        }

        const selects = Array.from(document.querySelectorAll('select')).filter(isVisibleAndEditable);
        for (const element of selects) {
            if (CLASS_HINT.test(describe(element))) return { type: 'select', element };
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
        let badge = document.getElementById('sp-autofill-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'sp-autofill-badge';
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

    function fillDimensions(pkg) {
        const values = {};
        Object.keys(FIELD_PATTERNS).forEach((key) => {
            const field = findField(key);
            if (!field) return;
            const raw = pkg[key];
            if (!Number.isFinite(Number(raw)) || Number(raw) <= 0) return;
            if (!isEmpty(field)) return; // Nutzereingaben nie überschreiben
            if (field.tagName === 'SELECT') {
                const option = Array.from(field.options).find((opt) => opt.value === String(raw) || opt.textContent.trim() === String(raw));
                if (!option) return;
                setSelectValue(field, option.value);
            } else {
                setNativeValue(field, withComma(raw));
            }
            values[key] = raw;
        });
        return values;
    }

    /**
     * Wählt die kleinste passende Paketklasse – aber nur, wenn im Formular noch
     * keine gewählt ist. Rückgabe: null (nichts gefunden), { changed, ... },
     * { chosen: true } (Nutzer war schneller) oder { tooBig: true }.
     */
    function chooseClass(provider, pkg) {
        const lib = window.sendPilotLib;
        if (!lib?.parcelClass) return null;

        const target = lib.parcelClass(provider, pkg);
        if (!target) return null;
        if (!target.fits) return { tooBig: true, sum: target.sum };

        const control = findClassControl();
        if (!control) return null;

        if (control.type === 'radio') {
            if (control.elements.some((element) => element.checked)) return { chosen: true };
            const element = control.elements.find((item) => String(item.value).trim().toUpperCase() === target.id);
            if (!element) return null;
            element.click();
            if (!element.checked) {
                element.checked = true;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { changed: true, label: target.label, sum: target.sum };
        }

        if (!isEmpty(control.element)) return { chosen: true };
        const option = Array.from(control.element.options).find((opt) => {
            const value = String(opt.value).trim().toUpperCase();
            const text = opt.textContent.trim().toUpperCase();
            return value === target.id || text === target.id || text.startsWith(`${target.id}-`) || text.startsWith(`${target.id} `);
        });
        if (!option) return null;
        setSelectValue(control.element, option.value);
        return { changed: true, label: target.label, sum: target.sum };
    }

    function fill(pkg) {
        const dimensions = fillDimensions(pkg);
        const filledDims = Object.keys(dimensions).length;
        const classResult = site.classes ? chooseClass(site.classes, pkg) : null;

        if (classResult?.tooBig) {
            showBadge(`✈ SendPilot: ${pkg.laenge} × ${pkg.breite} × ${pkg.hoehe} cm passen in keine Paketklasse`, 'warn');
            return { filled: 1, done: true };
        }

        if (classResult?.changed) {
            showBadge(`✈ SendPilot: ${pkg.laenge} × ${pkg.breite} × ${pkg.hoehe} cm → ${classResult.label}`, 'ok');
            return { filled: filledDims + 1, done: true };
        }

        if (classResult?.chosen && filledDims === 0) return { filled: 1, done: true };

        if (filledDims === 0) return { filled: 0, done: false };
        if (filledDims === 4) {
            showBadge(`✈ SendPilot: ${pkg.laenge} × ${pkg.breite} × ${pkg.hoehe} cm · ${pkg.gewicht} kg eingetragen`, 'ok');
            return { filled: 4, done: true };
        }
        showBadge(`✈ SendPilot: ${filledDims}/4 Felder gefüllt (${Object.keys(dimensions).join(', ')})`, 'warn');
        return { filled: filledDims, done: false };
    }

    async function run() {
        if (sessionStorage.getItem(FILLED_FLAG) === 'true') return { filled: 0, done: true };

        let stored;
        try {
            stored = await chrome.storage.local.get(STORAGE_KEY);
        } catch (e) {
            return { filled: 0, done: false };
        }
        const pkg = stored?.[STORAGE_KEY]?.pkg;
        if (!pkg) return { filled: 0, done: false };

        const result = fill(pkg);
        if (result.done) {
            sessionStorage.setItem(FILLED_FLAG, 'true');
        }
        return result;
    }

    // SPA: Felder erscheinen verzögert und nach jedem Schritt neu.
    // Der Observer bleibt aktiv, bis alles gefüllt ist – DHL fragt die Maße
    // erst im Versand-Schritt ab, Hermes/DPD die Klasse erst nach der Adresse.
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
            run().then((result) => {
                if (result.done) stop();
            });
        }, 400);
    });

    function start() {
        run().then((result) => {
            if (result.done) return;
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
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
