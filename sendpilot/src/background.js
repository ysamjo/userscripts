/* SendPilot – Service Worker
 *
 * Aufgaben:
 *  - Öffnet Paketda mit vorausgefüllten Maß-Parametern (Standard-Klick aufs Icon,
 *    wenn Option "Direkt zu Paketda" aktiv ist)
 *  - Hält den Verlauf der letzten Pakete (Sync-Ziel für content_scripts)
 *  - Rechnet Volumengewicht / Gurtmaß (gleiche Regeln wie popup/lib.js)
 */

// Muss identisch zu popup/lib.js bleiben (Service Worker kann keine ES-Module aus /popup laden
// ohne "type": "module"; deshalb bewusst dupliziert und klein gehalten).
const COURIERS = [
    { id: 'paketda', name: 'Paketda Preisvergleich', color: '#1e64c8', group: 'compare' },
    { id: 'kns', name: 'Klick-n-Schick', color: '#10b981', group: 'label' },
    { id: 'packlink', name: 'Packlink', color: '#0052cc', group: 'label' },
    { id: 'dhl', name: 'DHL Online-Porto', color: '#c8102e', group: 'label' },
    { id: 'hermes', name: 'Hermes', color: '#0a8fc4', group: 'label' },
    { id: 'dpd', name: 'DPD', color: '#dc0032', group: 'label' },
    { id: 'gls', name: 'GLS', color: '#ffcc00', group: 'label' },
    { id: 'ups', name: 'UPS', color: '#351c15', group: 'label' },
    { id: 'post', name: 'Deutsche Post (Brief)', color: '#ffcc00', group: 'letter' }
];

const HISTORY_KEY = 'sendpilot.history';
const EBAY_KEY = 'sendpilot.ebay';

// --- Paket-Mathematik (Spiegel von popup/lib.js) ---

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
    const vol = volumetricWeightKg(pkg, providerId === 'dhl' ? 5000 : 5000) || 0;
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
    packlink: (pkg) => `https://www.packlink.com/de-DE/?laenge=${Number(pkg.laenge) || ''}&breite=${Number(pkg.breite) || ''}&hoehe=${Number(pkg.hoehe) || ''}&gewicht=${Number(pkg.gewicht) || ''}`,
    dhl: () => 'https://www.dhl.de/de/privatkunden/pakete-versenden/online-frankieren.html',
    hermes: () => 'https://www.myhermes.de/versenden/pakete-verschicken/',
    dpd: () => 'https://www.dpd.com/de/de/paketversand/',
    gls: () => 'https://gls-group.com/DE/de/paket-versenden',
    ups: () => 'https://www.ups.com/de/de/support/shipping-support/shipping-costs-rates.page',
    post: () => 'https://www.deutschepost.de/de/b/briefe-ins-ausland.html'
};

function buildUrl(providerId, pkg, country = 'DE') {
    const builder = QUICK_URLS[providerId];
    if (!builder) return null;
    return builder(pkg || {}, country);
}

async function getSettings() {
    const { 'sendpilot.settings': settings } = await chrome.storage.sync.get('sendpilot.settings');
    return settings || { quickProvider: 'paketda', clickOpensPaketda: false, country: 'DE', divisor: 5000 };
}

async function getHistory() {
    const result = await chrome.storage.local.get(HISTORY_KEY);
    return Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
}

const HISTORY_LIMIT = 12;

async function pushHistory(entry) {
    if (!entry || !entry.pkg) return;
    const history = await getHistory();
    const key = [entry.pkg.laenge, entry.pkg.breite, entry.pkg.hoehe, entry.pkg.gewicht].join('|');
    const filtered = history.filter((item) => [item.pkg.laenge, item.pkg.breite, item.pkg.hoehe, item.pkg.gewicht].join('|') !== key);
    filtered.unshift({
        pkg: entry.pkg,
        provider: entry.provider || null,
        country: entry.country || 'DE',
        ts: Date.now()
    });
    await chrome.storage.local.set({ [HISTORY_KEY]: filtered.slice(0, HISTORY_LIMIT) });
}

const EBAY_LIMIT = 20;

const EBAY_API = {
    config: 'sendpilot.ebay.api',
    tokens: 'sendpilot.ebay.tokens',
    orders: 'sendpilot.ebay.orders'
};
const EBAY_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly';

function ebayEnv(name) {
    if (name === 'sandbox') {
        return { auth: 'https://auth.sandbox.ebay.com', api: 'https://api.sandbox.ebay.com' };
    }
    return { auth: 'https://auth.ebay.com', api: 'https://api.ebay.com' };
}

/** Normalisiert eine eBay-Bestellung auf das SendPilot-Format. */
function mapEbayOrder(order) {
    const instruction = (order.fulfillmentStartInstructions || [])[0] || {};
    const shipTo = (instruction.shippingStep && instruction.shippingStep.shipTo) || {};
    const address = shipTo.contactAddress || {};
    const item = (order.lineItems || [])[0] || {};
    const street = [address.addressLine1, address.addressLine2].filter(Boolean).join(' ');
    return {
        orderId: order.orderId || '',
        buyer: shipTo.fullName || (order.buyer && order.buyer.username) || '',
        street,
        zip: address.postalCode || '',
        city: address.city || '',
        country: address.countryCode || 'DE',
        item: item.title || '',
        quantity: item.quantity || 1,
        total: order.pricingSummary && order.pricingSummary.total
            ? `${order.pricingSummary.total.value} ${order.pricingSummary.total.currency || 'EUR'}`
            : '',
        createdDate: order.creationDate || '',
        status: order.orderFulfillmentStatus || '',
        source: 'api'
    };
}

/** Gültiges Access-Token holen, bei Ablauf mit dem Refresh-Token erneuern. */
async function ebayAccessToken() {
    const store = await chrome.storage.local.get([EBAY_API.config, EBAY_API.tokens]);
    const config = store[EBAY_API.config];
    const tokens = store[EBAY_API.tokens] || {};
    if (!config || !config.clientId || !config.clientSecret || !config.ruName) {
        throw new Error('eBay-API ist nicht eingerichtet (Einstellungen → eBay-API).');
    }
    if (tokens.accessToken && tokens.expiresAt && Date.now() < tokens.expiresAt) {
        return { config, accessToken: tokens.accessToken };
    }
    if (!tokens.refreshToken) {
        throw new Error('Keine eBay-Autorisierung – bitte in den Einstellungen verbinden.');
    }
    const env = ebayEnv(config.env);
    const response = await fetch(`${env.api}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
            scope: EBAY_SCOPE
        }).toString()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error((data.error_description) || `Token-Erneuerung fehlgeschlagen (HTTP ${response.status})`);
    }
    const fresh = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000 - 60000
    };
    await chrome.storage.local.set({ [EBAY_API.tokens]: fresh });
    return { config, accessToken: fresh.accessToken };
}

/** Holt Bestellungen der letzten N Tage (eBay-Limit: 90) und legt sie ab. */
async function syncEbayOrders(options = {}) {
    const { config, accessToken } = await ebayAccessToken();
    const env = ebayEnv(config.env);
    const days = Math.min(Math.max(Number(options.days) || 30, 1), 90);
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const from = new Date(Date.now() - days * 86400000).toISOString();
    const params = new URLSearchParams({ limit: String(limit) });
    if (options.unfulfilledOnly === false) {
        params.set('filter', `order.creationDate:[${from}..]`);
    } else {
        params.set('filter', `order.creationDate:[${from}..],order.orderFulfillmentStatus:{FULFILLED}`);
    }

    const response = await fetch(`${env.api}/sell/fulfillment/v1/order?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = (data.errors && data.errors[0]) || {};
        throw new Error(err.longMessage || err.message || `getOrders fehlgeschlagen (HTTP ${response.status})`);
    }
    const mapped = (Array.isArray(data.orders) ? data.orders : [])
        .map(mapEbayOrder)
        .filter((order) => order.orderId);
    await chrome.storage.local.set({ [EBAY_API.orders]: mapped.slice(0, EBAY_LIMIT) });
    return mapped;
}

/**
 * Legt einen von der eBay-Seite erfassten Verkauf ab (dedupliziert über orderId).
 */
async function pushEbayOrder(order) {
    if (!order || (!order.buyer && !order.orderId)) return;
    const result = await chrome.storage.local.get(EBAY_KEY);
    const list = Array.isArray(result[EBAY_KEY]) ? result[EBAY_KEY] : [];
    const key = order.orderId || [order.buyer, order.zip].join('|');
    const filtered = list.filter((item) => (item.orderId || [item.buyer, item.zip].join('|')) !== key);
    filtered.unshift({ ...order, ts: Date.now() });
    await chrome.storage.local.set({ [EBAY_KEY]: filtered.slice(0, EBAY_LIMIT) });
}

// --- Aktionen ---

chrome.action.onClicked.addListener(async () => {
    const settings = await getSettings();
    if (!settings.clickOpensPaketda) return; // Popup übernimmt
    const history = await getHistory();
    const pkg = history[0]?.pkg || null;
    const url = pkg ? buildUrl('paketda', pkg, settings.country) : buildUrl('paketda', {}, settings.country);
    await chrome.tabs.create({ url });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'SENDPILOT_PACKAGE') {
        pushHistory({ pkg: message.package, provider: message.provider, country: message.country })
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: String(error) }));
        return true;
    }

    if (message.type === 'SENDPILOT_EBAY_ORDER') {
        pushEbayOrder(message.order)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: String(error) }));
        return true;
    }

    if (message.type === 'SENDPILOT_EBAY_SYNC') {
        syncEbayOrders(message.options)
            .then((orders) => sendResponse({ ok: true, count: orders.length }))
            .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
        return true;
    }

    if (message.type === 'SENDPILOT_OPEN') {
        chrome.tabs.create({ url: message.url }).then((tab) => sendResponse({ ok: true, tabId: tab.id }));
        return true;
    }

    if (message.type === 'SENDPILOT_INFO') {
        sendResponse({
            ok: true,
            couriers: COURIERS,
            version: chrome.runtime.getManifest().version
        });
        return true;
    }

    return undefined;
});

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== 'install') return;
    const settings = await chrome.storage.sync.get('sendpilot.settings');
    if (!settings['sendpilot.settings']) {
        await chrome.storage.sync.set({
            'sendpilot.settings': { quickProvider: 'paketda', clickOpensPaketda: false, country: 'DE', divisor: 5000 }
        });
    }
});
