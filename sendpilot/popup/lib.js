/* SendPilot – gemeinsam genutzte Rechen- und URL-Logik
 *
 * Wird vom Popup (und in Tests per require) verwendet.
 * Der Service Worker (src/background.js) enthält bewusst eine Kopie,
 * weil MV3-Module dort nur mit "type": "module" importierbar wären.
 */

(function (root, factory) {
    const lib = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = lib;
    if (root) root.sendPilotLib = lib;
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    const DIVISORS = { dhl: 5000, ups: 5000, gls: 6000, hermes: 6000, dpd: 6000, default: 5000 };

    function sortedDims(pkg) {
        return [pkg.laenge, pkg.breite, pkg.hoehe]
            .map(Number)
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => b - a);
    }

    function girthCm(pkg) {
        const [l, b, h] = sortedDims(pkg);
        if (!l || !b || !h) return null;
        return l + 2 * b + 2 * h;
    }

    function volumetricWeightKg(pkg, divisor = 5000) {
        const [l, b, h] = sortedDims(pkg);
        if (!l || !b || !h) return null;
        return (l * b * h) / divisor;
    }

    function chargeableWeightKg(pkg, providerId) {
        const weight = Number(pkg.gewicht) || 0;
        const divisor = DIVISORS[providerId] || DIVISORS.default;
        const vol = volumetricWeightKg(pkg, divisor) || 0;
        return Math.max(weight, vol);
    }

    function missingFields(pkg) {
        const missing = [];
        if (!Number.isFinite(Number(pkg.laenge)) || Number(pkg.laenge) <= 0) missing.push('laenge');
        if (!Number.isFinite(Number(pkg.breite)) || Number(pkg.breite) <= 0) missing.push('breite');
        if (!Number.isFinite(Number(pkg.hoehe)) || Number(pkg.hoehe) <= 0) missing.push('hoehe');
        if (!Number.isFinite(Number(pkg.gewicht)) || Number(pkg.gewicht) <= 0) missing.push('gewicht');
        return missing;
    }

    function urlParams(pkg) {
        const params = new URLSearchParams();
        const [l, b, h] = sortedDims(pkg);
        if (l) params.set('laenge', String(l));
        if (b) params.set('breite', String(b));
        if (h) params.set('hoehe', String(h));
        if (Number(pkg.gewicht) > 0) params.set('gewicht', String(pkg.gewicht));
        return params;
    }

    const QUICK_URLS = {
        paketda: (pkg, country) => {
            const params = urlParams(pkg);
            if (country && country !== 'DE') params.set('land', country);
            return `https://www.paketda.de/paket-preis-rechner.php?${params.toString()}`;
        },
        kns: (pkg) => `https://www.klick-n-schick.com/portal/paketschein/paketversand?${urlParams(pkg).toString()}`,
        packlink: (pkg) => {
            const params = urlParams(pkg);
            return `https://www.packlink.com/de-DE/?${params.toString()}`;
        },
        dhl: () => 'https://www.dhl.de/de/privatkunden/pakete-versenden/online-frankieren.html',
        hermes: () => 'https://www.myhermes.de/versenden/pakete-verschicken/',
        dpd: () => 'https://www.dpd.com/de/de/paketversand/',
        gls: () => 'https://gls-group.com/DE/de/paket-versenden',
        ups: (pkg) => {
            const params = urlParams(pkg);
            const qs = params.toString();
            return qs
                ? `https://www.ups.com/de/de/support/shipping-support/shipping-costs-rates.page?${qs}`
                : 'https://www.ups.com/de/de/support/shipping-support/shipping-costs-rates.page';
        },
        post: () => 'https://www.deutschepost.de/de/b/briefe-ins-ausland.html'
    };

    function buildUrl(providerId, pkg, country = 'DE') {
        const builder = QUICK_URLS[providerId];
        if (!builder) return null;
        return builder(pkg || {}, country);
    }

    // --- eBay-Übergabe (kein API-Key nötig) --------------------------------
    //
    // Klick-n-Schick und Hermes haben einen eigenen eBay-Import im Konto.
    // DHL/Novapost bieten das für Privatkunden nicht an. SendPilot erfasst
    // die Verkaufsdaten deshalb einmal auf der eBay-Seite und legt sie in
    // genau dem Format ab, das die Portale bzw. die Zwischenablage brauchen.

    const EBAY_ORDER_FIELDS = ['buyer', 'street', 'city', 'zip', 'country', 'item', 'orderId'];

    /**
     * Baut aus einem erfassten eBay-Verkauf eine mehrzeilige Adresse,
     * wie sie Klick-n-Schick und Hermes im Import-Formular erwarten.
     */
    function ebayAddressBlock(order) {
        if (!order) return '';
        // Ohne Käufer und Straße gibt es keine sinnvolle Adresse
        if (!order.buyer && !order.street) return '';
        const lines = [];
        if (order.buyer) lines.push(String(order.buyer).trim());
        if (order.street) lines.push(String(order.street).trim());
        const cityLine = [order.zip, order.city].filter(Boolean).join(' ').trim();
        if (cityLine) lines.push(cityLine);
        const country = order.country && !/^(de|deutschland|germany)$/i.test(order.country)
            ? order.country
            : 'Deutschland';
        lines.push(country);
        return lines.filter(Boolean).join('\n');
    }

    /**
     * Hermes-CSV-Zeile (Semikolon, Spalten wie im csvimport-Formular).
     * Kopfzeile: Name;Strasse;PLZ;Ort;Land;Gewicht
     */
    function ebayCsvRow(order) {
        const country = order?.country || 'DE';
        const cells = [
            order?.buyer || '',
            order?.street || '',
            order?.zip || '',
            order?.city || '',
            country,
            order?.weight || ''
        ];
        return cells.map((cell) => String(cell).replace(/;/g, ',').trim()).join(';');
    }

    const EBAY_CSV_HEADER = 'Name;Strasse;PLZ;Ort;Land;Gewicht';

    /**
     * Welche Portale haben einen eigenen eBay-Import im Konto?
     */
    const EBAY_IMPORT_SUPPORT = {
        kns: {
            url: 'https://www.klick-n-schick.com/portal/ebayimport',
            mode: 'auto',
            note: 'Import stößt automatisch an, Maße werden je Zeile gesetzt'
        },
        hermes: {
            url: 'https://www.myhermes.de/meinkonto/ebayimport',
            mode: 'manual',
            note: 'eBay-Adressimport im Hermes-Konto (Login nötig)'
        }
    };

    /**
     * Verdichtet einen erfassten Verkauf zu einem Paketdatensatz.
     */
    function orderToPackage(order, fallback) {
        const pkg = {
            laenge: Number(order?.laenge) || Number(fallback?.laenge),
            breite: Number(order?.breite) || Number(fallback?.breite),
            hoehe: Number(order?.hoehe) || Number(fallback?.hoehe),
            gewicht: Number(order?.weight) || Number(order?.gewicht) || Number(fallback?.gewicht)
        };
        return pkg;
    }

    const LETTER_TIERS = [
        { name: 'Standardbrief', maxL: 23.5, maxB: 12.5, maxH: 0.5, maxW: 20, price: 0.95 },
        { name: 'Kompaktbrief', maxL: 23.5, maxB: 12.5, maxH: 1, maxW: 50, price: 1.10 },
        { name: 'Großbrief', maxL: 35.3, maxB: 25, maxH: 2, maxW: 500, price: 1.80 },
        { name: 'Maxibrief', maxL: 35.3, maxB: 25, maxH: 5, maxW: 1000, price: 2.90 }
    ];

    function letterTier(pkg) {
        const [l, b, h] = sortedDims(pkg);
        const weightG = (Number(pkg.gewicht) || 0) * 1000;
        if (!l || !b || !h) return null;
        for (const tier of LETTER_TIERS) {
            if (l <= tier.maxL && b <= tier.maxB && h <= tier.maxH && weightG <= tier.maxW) {
                return tier;
            }
        }
        return null;
    }

    function formatKg(value) {
        if (!Number.isFinite(value) || value <= 0) return '–';
        return `${value.toFixed(2).replace('.', ',')} kg`;
    }

    return {
        DIVISORS,
        LETTER_TIERS,
        QUICK_URLS,
        EBAY_ORDER_FIELDS,
        EBAY_CSV_HEADER,
        EBAY_IMPORT_SUPPORT,
        ebayAddressBlock,
        ebayCsvRow,
        orderToPackage,
        sortedDims,
        girthCm,
        volumetricWeightKg,
        chargeableWeightKg,
        missingFields,
        urlParams,
        buildUrl,
        letterTier,
        formatKg
    };
});
