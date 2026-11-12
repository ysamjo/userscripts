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
