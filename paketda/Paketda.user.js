// ==UserScript==
// @name         Paketda Packlink Button & Adblock Remover
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Ergänzt Packlink-Buttons, Klick-n-Schick als passendes Angebot und entfernt den Adblock-Hinweis.
// @match        https://www.paketda.de/paket-preis-rechner.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=paketda.de
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const KNS_URL = 'https://www.klick-n-schick.com/portal/paketschein/paketversand';
    const KNS_LOGO = 'https://www.klick-n-schick.com/images/portal/logo.png';
    const PACKLINK_URL = 'https://paypal.packlink.com/de/private/shipments/create/info';
    const PACKLINK_QUOTE_URL = 'https://www.packlink.com/de-DE/';
    const PACKLINK_LOGO = 'https://cdn.packlink.com/apps/giger/logos/packlink.svg';

    // --- 1. Adblock-Banner entfernen ---
    function removeAdblockBanner() {
        document.querySelectorAll('div, .alert').forEach((element) => {
            const text = (element.innerText || '').toLowerCase();
            if (text.includes('adblocker') && text.includes('deaktiviere') && text.length < 500) {
                element.remove();
            }
        });
    }

    removeAdblockBanner();

    let adblockTimer;
    const observer = new MutationObserver(() => {
        clearTimeout(adblockTimer);
        adblockTimer = setTimeout(removeAdblockBanner, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // --- 2. Maße, Gewicht und Zielland lesen ---
    const params = new URLSearchParams(window.location.search);

    function readNumber(name) {
        const rawValue = params.get(name) || document.querySelector(`[name="${name}"]`)?.value || '';
        return Number.parseFloat(String(rawValue).replace(',', '.'));
    }

    const weight = readNumber('gewicht');
    const dimensions = [readNumber('laenge'), readNumber('breite'), readNumber('hoehe')]
        .sort((a, b) => b - a);
    const land = params.has('land')
        ? params.get('land')
        : document.querySelector('[name="land"]')?.value;

    const [longest, middle, shortest] = dimensions;
    const girth = longest + (2 * middle) + (2 * shortest);
    const hasPackageData = [weight, longest, middle, shortest].every(Number.isFinite);
    const isGermany = !land;
    const fitsKlickNSchick = hasPackageData
        && isGermany
        && weight > 0
        && weight <= 10
        && longest <= 200
        && middle <= 80
        && shortest <= 60
        && girth <= 300;
    const dpdSizeMetric = longest + shortest;
    const packlinkDpdTariff = dpdSizeMetric <= 35
        ? { size: 'XS', netPrice: 4.74 }
        : dpdSizeMetric <= 50
            ? { size: 'S', netPrice: 5.31 }
            : dpdSizeMetric <= 70
                ? { size: 'M', netPrice: 7.38 }
                : dpdSizeMetric <= 90
                    ? { size: 'L', netPrice: 16.37 }
                    : { size: 'XL', netPrice: 28.61 };
    const fitsPacklink = hasPackageData
        && isGermany
        && weight > 0
        && weight <= 20
        && dimensions.every((dimension) => dimension > 0)
        && longest <= 100
        && girth <= 250;

    // --- 3. Einheitliches Styling ---
    const style = document.createElement('style');
    style.textContent = `
        .custom-btn-modern {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 0 16px;
            height: 38px;
            box-sizing: border-box;
            border-radius: 6px;
            text-decoration: none !important;
            font-weight: 600;
            font-size: 14px;
            margin: 5px 12px 5px 0;
            transition: all 0.2s ease-in-out;
            cursor: pointer;
            color: #ffffff !important;
        }

        .custom-btn-modern svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
            flex-shrink: 0;
        }

        .btn-packlink {
            background: linear-gradient(135deg, #0052cc, #003d99);
            border: 1px solid #003380;
            box-shadow: 0 2px 4px rgba(0, 82, 204, 0.2);
        }

        .btn-packlink:hover {
            background: linear-gradient(135deg, #003d99, #002966);
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0, 82, 204, 0.35);
        }

        .btn-klick {
            background: linear-gradient(135deg, #10b981, #059669);
            border: 1px solid #047857;
            box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);
        }

        .btn-klick:hover {
            background: linear-gradient(135deg, #059669, #047857);
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(16, 185, 129, 0.35);
        }

        .btn-anchor {
            background: linear-gradient(135deg, #4b5563, #374151);
            border: 1px solid #1f2937;
            box-shadow: 0 2px 4px rgba(75, 85, 99, 0.2);
        }

        .btn-anchor:hover {
            background: linear-gradient(135deg, #374151, #1f2937);
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(75, 85, 99, 0.35);
        }

        .custom-btn-modern:active {
            transform: translateY(0);
        }

        .kns-offer-logo {
            width: 106px;
            height: 22px;
            object-fit: contain;
        }

        .kns-offer-row td {
            background: #f5fff9;
        }

        .packlink-offer-logo {
            width: 100px;
            height: 32px;
            object-fit: contain;
        }

        .packlink-offer-row td {
            background: #f5f8ff;
        }

        .novapost-original-price {
            color: #777;
            font-size: 0.85em;
            text-decoration: line-through;
            white-space: nowrap;
        }

        .novapost-discount-price {
            color: #17833b;
            font-weight: 700;
            white-space: nowrap;
        }

        .novapost-discount-price small {
            font-size: 0.72em;
            font-weight: 600;
        }

        html {
            scroll-behavior: smooth;
        }
    `;
    document.head.appendChild(style);

    // --- 4. Klick-n-Schick in die Desktop- und Mobil-Angebotsliste einfügen ---
    function euro(value) {
        return `€ ${value.toFixed(2).replace('.', ',')}`;
    }

    function offerDetails(productName) {
        const wrapper = document.createDocumentFragment();
        const link = document.createElement('a');
        link.href = KNS_URL;
        link.target = '_blank';
        link.rel = 'noopener noreferrer nofollow';

        const logo = document.createElement('img');
        logo.src = KNS_LOGO;
        logo.alt = 'Klick-n-Schick';
        logo.title = 'Klick-n-Schick';
        logo.className = 'kns-offer-logo';
        link.append(logo, document.createElement('br'), productName);

        const details = document.createElement('div');
        details.style.cssText = 'font-size:0.8em;margin-top:0.5em;';
        details.textContent = '🖨 Paketschein zum Drucken · Abgabe im DPD-Paketshop';

        wrapper.append(link, document.createElement('br'), details);
        return wrapper;
    }

    function insertByPrice(tbody, row, price, priceCellIndex) {
        const existingRows = Array.from(tbody.rows);
        const nextRow = existingRows.find((candidate) => {
            if (candidate === row) return false;
            const cell = candidate.cells[priceCellIndex];
            const raw = cell?.getAttribute('sorttable_customkey') || cell?.textContent || '';
            const candidatePrice = Number.parseFloat(raw.replace(/[^0-9,.-]/g, '').replace(',', '.'));
            return Number.isFinite(candidatePrice) && candidatePrice > price;
        });

        tbody.insertBefore(row, nextRow || null);
    }

    function addKlickNSchickOffer() {
        if (!fitsKlickNSchick || document.querySelector('.kns-offer-row')) return;

        const price = weight <= 2 ? 4.90 : 5.80;
        const netPrice = price / 1.19;
        const productName = `Klick-n-Schick Paket bis ${weight <= 2 ? 2 : 10} kg`;

        const desktopBody = document.querySelector('#desktop_tabelle tbody');
        if (desktopBody) {
            const row = document.createElement('tr');
            row.className = 'kns-offer-row';

            const providerCell = document.createElement('td');
            providerCell.append(offerDetails(productName));

            const onlineCell = document.createElement('td');
            onlineCell.setAttribute('sorttable_customkey', String(price));
            onlineCell.dataset.netto = euro(netPrice);
            onlineCell.dataset.brutto = euro(price);
            onlineCell.textContent = euro(price);

            const pickupCell = document.createElement('td');
            pickupCell.setAttribute('sorttable_customkey', '999');
            pickupCell.dataset.netto = '';
            pickupCell.dataset.brutto = '';

            const shopCell = pickupCell.cloneNode(true);
            row.append(providerCell, onlineCell, pickupCell, shopCell);
            insertByPrice(desktopBody, row, price, 1);
        }

        const mobileBody = document.querySelector('#tabelle_porto_online tbody');
        if (mobileBody) {
            const row = document.createElement('tr');
            row.className = 'kns-offer-row kns-offer-row-mobile';

            const providerCell = document.createElement('td');
            providerCell.append(offerDetails(productName));

            const priceCell = document.createElement('td');
            priceCell.textContent = euro(price);

            row.append(providerCell, priceCell);
            insertByPrice(mobileBody, row, price, 1);
        }
    }

    addKlickNSchickOffer();

    // --- 5. Öffentlichen Packlink-Ab-Preis in die Angebotsliste einfügen ---
    function packlinkOfferDetails(productName) {
        const wrapper = document.createDocumentFragment();
        const link = document.createElement('a');
        link.href = PACKLINK_QUOTE_URL;
        link.target = '_blank';
        link.rel = 'noopener noreferrer nofollow';

        const logo = document.createElement('img');
        logo.src = PACKLINK_LOGO;
        logo.alt = 'Packlink';
        logo.title = 'Packlink';
        logo.className = 'packlink-offer-logo';
        link.append(logo, document.createElement('br'), productName);

        const details = document.createElement('div');
        details.style.cssText = 'font-size:0.8em;margin-top:0.5em;';
        details.textContent = 'DPD-Paketshop-Richtpreis · inklusive 19 % MwSt. · kann je nach PLZ abweichen';

        wrapper.append(link, document.createElement('br'), details);
        return wrapper;
    }

    function addPacklinkOffer() {
        if (!fitsPacklink || document.querySelector('.packlink-offer-row')) return;

        const netPrice = packlinkDpdTariff.netPrice;
        const price = netPrice * 1.19;
        const productName = `Packlink DPD Paketshop ${packlinkDpdTariff.size} (bis 20 kg)`;

        const desktopBody = document.querySelector('#desktop_tabelle tbody');
        if (desktopBody) {
            const row = document.createElement('tr');
            row.className = 'packlink-offer-row';

            const providerCell = document.createElement('td');
            providerCell.append(packlinkOfferDetails(productName));

            const onlineCell = document.createElement('td');
            onlineCell.setAttribute('sorttable_customkey', String(price));
            onlineCell.dataset.netto = euro(netPrice);
            onlineCell.dataset.brutto = euro(price);
            onlineCell.textContent = euro(price);

            const pickupCell = document.createElement('td');
            pickupCell.setAttribute('sorttable_customkey', '999');
            pickupCell.dataset.netto = '';
            pickupCell.dataset.brutto = '';

            const shopCell = pickupCell.cloneNode(true);
            row.append(providerCell, onlineCell, pickupCell, shopCell);
            insertByPrice(desktopBody, row, price, 1);
        }

        const mobileBody = document.querySelector('#tabelle_porto_online tbody');
        if (mobileBody) {
            const row = document.createElement('tr');
            row.className = 'packlink-offer-row packlink-offer-row-mobile';

            const providerCell = document.createElement('td');
            providerCell.append(packlinkOfferDetails(productName));

            const priceCell = document.createElement('td');
            priceCell.textContent = euro(price);

            row.append(providerCell, priceCell);
            insertByPrice(mobileBody, row, price, 1);
        }
    }

    addPacklinkOffer();

    // --- 6. Novapost-Preise zusätzlich mit 25 % Rabatt anzeigen ---
    function parseEuro(value) {
        const normalized = String(value || '')
            .replace(/[^0-9,.-]/g, '')
            .replace(',', '.');
        const number = Number.parseFloat(normalized);
        return Number.isFinite(number) ? number : null;
    }

    function discountedPriceHtml(originalPrice) {
        const reducedPrice = originalPrice * 0.75;
        return `<span class="novapost-original-price">${euro(originalPrice)}</span><br>`
            + `<span class="novapost-discount-price">${euro(reducedPrice)} <small>(−25 %)</small></span>`;
    }

    function addNovapostDiscounts() {
        const tables = document.querySelectorAll(
            '#desktop_tabelle, #tabelle_porto_online, #tabelle_porto_abholung, #tabelle_porto_filiale'
        );

        tables.forEach((table) => {
            Array.from(table.tBodies[0]?.rows || []).forEach((row) => {
                if (!row.cells[0]?.textContent.toLowerCase().includes('novapost')) return;

                Array.from(row.cells).slice(1).forEach((cell, cellOffset) => {
                    const grossPrice = parseEuro(cell.dataset.brutto || cell.textContent);
                    if (grossPrice === null || grossPrice <= 0) return;

                    if (cellOffset === 0) {
                        row.dataset.novapostReducedPrice = String(grossPrice * 0.75);
                    }

                    const netPrice = parseEuro(cell.dataset.netto);
                    const grossHtml = discountedPriceHtml(grossPrice);
                    cell.innerHTML = grossHtml;

                    if ('brutto' in cell.dataset) {
                        cell.dataset.brutto = grossHtml;
                    }
                    if (netPrice !== null) {
                        cell.dataset.netto = discountedPriceHtml(netPrice);
                    }
                    if (cell.hasAttribute('sorttable_customkey')) {
                        cell.setAttribute('sorttable_customkey', String(grossPrice * 0.75));
                    }
                });

                const priceCellIndex = 1;
                const reducedPrice = Number.parseFloat(row.dataset.novapostReducedPrice);
                if (Number.isFinite(reducedPrice)) {
                    insertByPrice(table.tBodies[0], row, reducedPrice, priceCellIndex);
                }
            });
        });
    }

    addNovapostDiscounts();

    // --- 7. Vorhandenen Brief-Link durch die drei Schnellbuttons ersetzen ---
    if (!hasPackageData) return;

    const briefLink = document.querySelector('a[href*="deutschepost.de/de/p/portoberater.html"]');
    const container = briefLink?.parentElement;
    if (!briefLink || !container || document.querySelector('.custom-btn-modern')) return;

    const packageIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 16.5C21 16.88 20.79 17.21 20.47 17.38L12.57 21.82C12.41 21.91 12.21 21.96 12 21.96C11.79 21.96 11.59 21.91 11.43 21.82L3.53 17.38C3.21 17.21 3 16.88 3 16.5V7.5C3 7.12 3.21 6.79 3.53 6.62L11.43 2.18C11.59 2.09 11.79 2.04 12 2.04C12.21 2.04 12.41 2.09 12.57 2.18L20.47 6.62C20.79 6.79 21 7.12 21 7.5V16.5ZM12 4.15L5.61 7.74L12 11.33L18.39 7.74L12 4.15ZM4.5 9.22V15.78L11.25 19.57V13.01L4.5 9.22ZM12.75 13.01V19.57L19.5 15.78V9.22L12.75 13.01Z"/>
        </svg>
    `;

    const truckIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
        </svg>
    `;

    const arrowDownIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19L5 12h4V5h6v7h4l-7 7z"/>
        </svg>
    `;

    function makeButton(className, href, icon, label, newTab = false) {
        const link = document.createElement('a');
        link.className = `custom-btn-modern ${className}`;
        link.href = href;
        if (newTab) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
        link.innerHTML = `${icon}<span>${label}</span>`;
        return link;
    }

    const packlinkButton = makeButton(
        'btn-packlink',
        PACKLINK_URL,
        packageIcon,
        'Versenden mit Packlink',
        true
    );
    const klickButton = makeButton('btn-klick', KNS_URL, truckIcon, 'Klick-n-Schick', true);
    const resultButton = makeButton('btn-anchor', '#ergebnis', arrowDownIcon, 'Zum Ergebnis');

    briefLink.remove();
    container.prepend(packlinkButton, klickButton, resultButton);
})();
