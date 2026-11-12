/* SendPilot – eBay-Verkaufsdaten erfassen
 *
 * Läuft auf eBay-Verkaufsübersicht und Verkaufsdetails. Liest Käuferadresse,
 * Artikel und Bestellnummer aus dem DOM (kein API-Key, keine Anmeldung bei eBay
 * von außen) und bietet sie als übernehmbaren Block an.
 *
 * Bewusste Grenzen:
 *  - eBay ändert sein DOM häufig; alle Selektoren sind mehrfach abgesichert und
 *    fallen auf Textmuster zurück.
 *  - Sendet nichts an Server. Daten bleiben lokal (chrome.storage.local) und
 *    werden nur auf ausdrücklichen Klick in die Zwischenablage gelegt.
 */

(function () {
    'use strict';

    if (window.__sendPilotEbayLoaded) return;
    window.__sendPilotEbayLoaded = true;

    const isDetailPage = /\/itm\/|\/order/i.test(location.pathname + location.search);

    // --- 1. Hilfsfunktionen -------------------------------------------------

    function pickText(selectors) {
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            const text = el?.innerText?.trim();
            if (text) return text.replace(/\s+/g, ' ');
        }
        return '';
    }

    /**
     * Zerlegt einen mehrzeiligen Adressblock in Bestandteile.
     * eBay liefert je nach Ansicht "Name\nStraße\nPLZ Ort" oder alles in einer Zeile.
     */
    function parseAddressBlock(raw) {
        if (!raw) return null;
        const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length < 2) return null;

        const result = { buyer: '', street: '', zip: '', city: '', country: 'DE' };
        const zipCity = /^([A-Z]{0,2}-?\s?)?(\d{4,5})\s+(.+)$/;
        const countryLine = /^(deutschland|germany|österreich|austria|schweiz|switzerland|niederlande|frankreich)$/i;

        // Länderangabe ist meist die letzte Zeile
        const last = lines[lines.length - 1];
        if (countryLine.test(last)) {
            result.country = /deutschland|germany/i.test(last) ? 'DE'
                : /österreich|austria/i.test(last) ? 'AT'
                    : /schweiz|switzerland/i.test(last) ? 'CH'
                        : /niederlande/i.test(last) ? 'NL' : 'FR';
            lines.pop();
        }

        // PLZ + Ort finden (von hinten, weil Name/Straße davor stehen)
        for (let i = lines.length - 1; i >= 0; i--) {
            const match = lines[i].match(zipCity);
            if (match) {
                result.zip = match[2];
                result.city = match[3].trim();
                lines.splice(i, 1);
                break;
            }
        }

        if (lines.length > 0) result.buyer = lines.shift();
        if (lines.length > 0) result.street = lines.shift();

        if (!result.buyer || !result.street || !result.zip) return null;
        return result;
    }

    // --- 2. Daten aus der Seite lesen ---------------------------------------

    function readOrder() {
        // Reihenfolge = Zuverlässigkeit. eBay wechselt zwischen alten und neuen Layouts.
        const rawAddress = [
            '#fulfillmentOrderAddress',
            '[data-testid="shipping-address"]',
            '[data-testid="buyer-address"]',
            '.ux-layout-section__item .ux-textspans--PSEUDO_LINK',
            '#shippingAddress',
            '.shipping-address'
        ].map((selector) => document.querySelector(selector))
            .map((el) => el?.innerText || '')
            .find((text) => text.split('\n').filter((l) => l.trim()).length >= 2) || '';

        const address = parseAddressBlock(rawAddress);

        const item = pickText([
            '[data-testid="item-title"]',
            '.it-ttl',
            'h1.x-item-title__mainTitle',
            '#itemTitle'
        ]);

        const orderId = (pickText([
            '[data-testid="order-id"]',
            '.order-id',
            '[data-testid="order-number"]'
        ]).match(/\d{2}-\d{5}-\d{5}/) || [])[0] || '';

        if (!address && !item && !orderId) return null;

        return {
            buyer: address?.buyer || '',
            street: address?.street || '',
            zip: address?.zip || '',
            city: address?.city || '',
            country: address?.country || 'DE',
            item,
            orderId,
            url: location.href.split('?')[0],
            ts: Date.now()
        };
    }

    // --- 3. UI: schwebende Leiste -----------------------------------------

    function renderBar(order) {
        if (document.getElementById('sp-ebay-bar') || !order) return;

        const bar = document.createElement('div');
        bar.id = 'sp-ebay-bar';
        bar.style.cssText = `
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2147483000;
            background: #fff;
            border: 1px solid #d6dbe6;
            border-radius: 10px;
            box-shadow: 0 8px 24px rgba(16, 24, 40, 0.18);
            padding: 10px 12px;
            font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1c2430;
            max-width: 320px;
        `;

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:700;margin-bottom:6px;display:flex;gap:6px;align-items:center;';
        title.textContent = '✈ SendPilot: Verkauf übernehmen';

        const preview = document.createElement('div');
        preview.style.cssText = 'white-space:pre-line;background:#f7f9fc;border:1px solid #e5e9f2;border-radius:6px;padding:6px 8px;font-size:11px;color:#48546b;max-height:96px;overflow:auto;';
        preview.textContent = [order.buyer, order.street, `${order.zip} ${order.city}`.trim(), order.country]
            .filter(Boolean).join('\n') || 'Adresse nicht erkannt – bitte auf der Verkaufsdetailseite öffnen.';

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = '📋 Adresse kopieren';
        copyBtn.style.cssText = 'background:#1e40af;color:#fff;border:0;border-radius:6px;padding:5px 9px;font-size:11px;font-weight:600;cursor:pointer;';
        copyBtn.addEventListener('click', async () => {
            const text = [order.buyer, order.street, `${order.zip} ${order.city}`.trim(), order.country === 'DE' ? 'Deutschland' : order.country]
                .filter(Boolean).join('\n');
            try {
                await navigator.clipboard.writeText(text);
                copyBtn.textContent = '✓ kopiert';
                setTimeout(() => { copyBtn.textContent = '📋 Adresse kopieren'; }, 1400);
            } catch (e) {
                copyBtn.textContent = 'Kopieren blockiert';
            }
        });

        const csvBtn = document.createElement('button');
        csvBtn.type = 'button';
        csvBtn.textContent = '⬇ Hermes-CSV';
        csvBtn.style.cssText = 'background:#fff;color:#1e40af;border:1px solid #c7d2fe;border-radius:6px;padding:5px 9px;font-size:11px;font-weight:600;cursor:pointer;';
        csvBtn.addEventListener('click', () => {
            // Bewusst ohne lib.js: Content-Script bleibt eigenständig
            const header = 'Name;Strasse;PLZ;Ort;Land;Gewicht';
            const row = [order.buyer, order.street, order.zip, order.city, order.country, '']
                .map((c) => String(c).replace(/;/g, ',')).join(';');
            const blob = new Blob([`${header}\n${row}\n`], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sendpilot-hermes-${order.orderId || 'verkauf'}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        });

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = '💾 in SendPilot';
        saveBtn.style.cssText = 'background:#10b981;color:#fff;border:0;border-radius:6px;padding:5px 9px;font-size:11px;font-weight:600;cursor:pointer;';
        saveBtn.addEventListener('click', () => {
            try {
                chrome.runtime.sendMessage({ type: 'SENDPILOT_EBAY_ORDER', order }, () => void chrome.runtime.lastError);
                saveBtn.textContent = '✓ gespeichert';
                setTimeout(() => { saveBtn.textContent = '💾 in SendPilot'; }, 1400);
            } catch (e) {
                saveBtn.textContent = 'nicht verfügbar';
            }
        });

        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '✕';
        close.title = 'Ausblenden';
        close.style.cssText = 'position:absolute;top:6px;right:8px;background:transparent;border:0;color:#94a3b8;cursor:pointer;font-size:13px;';
        close.addEventListener('click', () => bar.remove());

        bar.style.position = 'fixed';
        actions.append(copyBtn, csvBtn, saveBtn);
        bar.append(close, title, preview, actions);
        document.body.appendChild(bar);
    }

    // --- 4. Start ----------------------------------------------------------

    function scan() {
        const order = readOrder();
        if (order) renderBar(order);
    }

    if (isDetailPage) {
        setTimeout(scan, 1200);
        setTimeout(scan, 3500);
    } else {
        // Verkaufsübersicht: nur Hinweis, keine Sammelerfassung (bewusst)
        setTimeout(() => {
            if (document.getElementById('sp-ebay-bar')) return;
            const hint = document.createElement('div');
            hint.id = 'sp-ebay-bar';
            hint.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;background:#fff;border:1px solid #d6dbe6;border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.18);padding:10px 12px;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c2430;max-width:300px;';
            hint.textContent = '✈ SendPilot: Verkauf öffnen, um die Käuferadresse zu übernehmen.';
            document.body.appendChild(hint);
        }, 1800);
    }
})();
