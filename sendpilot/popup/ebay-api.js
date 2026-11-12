/* SendPilot – eBay Sell Fulfillment API (Bestellungen lesen)
 *
 * Warum es einen kleinen Umweg braucht:
 *  - eBay erwartet als `redirect_uri` keine URL, sondern eine **RuName**.
 *  - Als "Auth accepted URL" der RuName lässt eBay **kein** `http://localhost` zu,
 *    sondern nur HTTPS (siehe developer.ebay.com/develop/guides/sell/authorization).
 *  - Chrome-Extensions können für `chrome.identity.launchWebAuthFlow` eine
 *    `https://<id>.chromiumapp.org/`-URL nutzen – die ruft nie einen Server auf,
 *    Chrome fängt die Weiterleitung intern ab. Genau diese URL tragen wir als
 *    Auth accepted URL in die RuName ein.
 *
 * Ablauf:
 *  1. authorize-URL bauen  -> im Tab öffnen (bestätigen tut der Nutzer)
 *  2. Rücksprung auf chromiumapp.org enthält ?code=…  -> Extension fängt ab
 *  3. Code gegen Access-/Refresh-Token tauschen (Basic Auth mit Client-Secret)
 *  4. getOrders mit dem Access-Token; Access-Token läuft nach 2 h ab,
 *     Refresh-Token hält ~18 Monate und wird stumm erneuert.
 *
 * Sicherheit:
 *  - Client-Secret liegt nur in chrome.storage.local (nicht syncen, nicht loggen)
 *  - Refresh-Token ebenso; niemals in URLs
 *  - Scope bewusst readonly
 */

const EBAY = (() => {
    'use strict';

    const ENVIRONMENTS = {
        production: {
            authHost: 'https://auth.ebay.com',
            apiHost: 'https://api.ebay.com',
            label: 'Produktion'
        },
        sandbox: {
            authHost: 'https://auth.sandbox.ebay.com',
            apiHost: 'https://api.sandbox.ebay.com',
            label: 'Sandbox'
        }
    };

    const SCOPES = [
        'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly'
    ];

    const KEYS = {
        config: 'sendpilot.ebay.api',      // clientId, clientSecret, ruName, env
        tokens: 'sendpilot.ebay.tokens',   // refreshToken, accessToken, expiresAt
        orders: 'sendpilot.ebay.orders'    // zuletzt geladene Bestellungen
    };

    // --- Konfiguration -----------------------------------------------------

    async function getConfig() {
        const result = await chrome.storage.local.get(KEYS.config);
        return result[KEYS.config] || null;
    }

    async function saveConfig(config) {
        const clean = {
            clientId: String(config.clientId || '').trim(),
            clientSecret: String(config.clientSecret || '').trim(),
            ruName: String(config.ruName || '').trim(),
            env: ENVIRONMENTS[config.env] ? config.env : 'production'
        };
        await chrome.storage.local.set({ [KEYS.config]: clean });
        return clean;
    }

    async function getTokens() {
        const result = await chrome.storage.local.get(KEYS.tokens);
        return result[KEYS.tokens] || {};
    }

    async function saveTokens(tokens) {
        await chrome.storage.local.set({ [KEYS.tokens]: tokens });
    }

    async function clearTokens() {
        await chrome.storage.local.remove(KEYS.tokens);
    }

    async function clearAll() {
        await chrome.storage.local.remove([KEYS.config, KEYS.tokens, KEYS.orders]);
    }

    // --- OAuth -------------------------------------------------------------

    function redirectUrl() {
        // Chromium fängt jede Weiterleitung auf diese Domain ab, ohne Netzwerkzugriff.
        return chrome.identity.getRedirectURL();
    }

    /**
     * Authorize-URL für den Nutzer. redirect_uri = RuName (nicht die URL!).
     */
    function buildAuthorizeUrl(config, state) {
        const env = ENVIRONMENTS[config.env] || ENVIRONMENTS.production;
        const params = new URLSearchParams({
            client_id: config.clientId,
            response_type: 'code',
            redirect_uri: config.ruName,
            scope: SCOPES.join(' '),
            state: state || 'sendpilot'
        });
        return `${env.authHost}/oauth2/authorize?${params.toString()}`;
    }

    /**
     * Öffnet den eBay-Zustimmungsdialog im interaktiven Fenster und wartet
     * auf den Rücksprung mit ?code=…
     */
    function authorize(config) {
        const state = `sp-${Date.now()}`;
        const url = buildAuthorizeUrl(config, state);
        return new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirect) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    reject(new Error(lastError.message));
                    return;
                }
                if (!redirect) {
                    reject(new Error('Kein Rücksprung von eBay erhalten.'));
                    return;
                }
                let code = '';
                try {
                    code = new URL(redirect).searchParams.get('code') || '';
                } catch (e) {
                    reject(new Error('Rücksprung-URL nicht lesbar.'));
                    return;
                }
                if (!code) {
                    reject(new Error('eBay hat keinen Autorisierungscode geliefert (Zustimmung abgebrochen?).'));
                    return;
                }
                resolve(code);
            });
        });
    }

    /**
     * Tauscht den Code in Access- und Refresh-Token.
     * eBay verlangt Basic Auth aus client_id:client_secret.
     */
    async function exchangeCode(config, code) {
        const env = ENVIRONMENTS[config.env] || ENVIRONMENTS.production;
        const basic = btoa(`${config.clientId}:${config.clientSecret}`);
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.ruName
        });

        const response = await fetch(`${env.apiHost}/identity/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: `Basic ${basic}`
            },
            body: body.toString()
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error_description || data.error || `Token-Tausch fehlgeschlagen (HTTP ${response.status})`);
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000 - 60000
        };
    }

    /**
     * Erneuert das Access-Token mit dem Refresh-Token (Scope muss erneut mit).
     */
    async function refreshAccessToken(config, refreshToken) {
        const env = ENVIRONMENTS[config.env] || ENVIRONMENTS.production;
        const basic = btoa(`${config.clientId}:${config.clientSecret}`);
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            scope: SCOPES.join(' ')
        });

        const response = await fetch(`${env.apiHost}/identity/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: `Basic ${basic}`
            },
            body: body.toString()
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error_description || data.error || `Token-Erneuerung fehlgeschlagen (HTTP ${response.status})`);
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000 - 60000
        };
    }

    /**
     * Gültiges Access-Token, erneuert bei Bedarf.
     */
    async function ensureAccessToken() {
        const config = await getConfig();
        if (!config?.clientId || !config?.clientSecret || !config?.ruName) {
            throw new Error('eBay-API ist noch nicht eingerichtet.');
        }
        const tokens = await getTokens();
        if (tokens.accessToken && tokens.expiresAt && Date.now() < tokens.expiresAt) {
            return { config, accessToken: tokens.accessToken };
        }
        if (!tokens.refreshToken) {
            throw new Error('Keine eBay-Autorisierung vorhanden – bitte in den Einstellungen verbinden.');
        }
        const fresh = await refreshAccessToken(config, tokens.refreshToken);
        await saveTokens(fresh);
        return { config, accessToken: fresh.accessToken };
    }

    // --- Bestellungen ------------------------------------------------------

    /**
     * Liest Bestellungen. Zeitraum ist bei eBay auf 90 Tage begrenzt.
     * filter = order.creationDate:[START..END]
     */
    async function fetchOrders(options = {}) {
        const { config, accessToken } = await ensureAccessToken();
        const env = ENVIRONMENTS[config.env] || ENVIRONMENTS.production;
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
        const days = Math.min(Math.max(Number(options.days) || 30, 1), 90);

        const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const params = new URLSearchParams({
            filter: `order.creationDate:[${from}..]`,
            limit: String(limit)
        });
        if (options.unfulfilledOnly !== false) {
            params.set('filter', `order.creationDate:[${from}..],order.orderFulfillmentStatus:{FULFILLED}`);
        }

        const response = await fetch(`${env.apiHost}/sell/fulfillment/v1/order?${params.toString()}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json'
            }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = (data.errors && data.errors[0]) || {};
            throw new Error(err.longMessage || err.message || `getOrders fehlgeschlagen (HTTP ${response.status})`);
        }
        return Array.isArray(data.orders) ? data.orders : [];
    }

    /**
     * Wandelt eine eBay-Bestellung in das schlanke SendPilot-Format.
     * Bewusst defensiv: fehlende Felder dürfen nicht werfen.
     */
    function mapOrder(order) {
        const fulfillment = (order.fulfillmentStartInstructions || [])[0] || {};
        const shipTo = fulfillment.shippingStep?.shipTo || {};
        const address = shipTo.contactAddress || {};
        const item = (order.lineItems || [])[0] || {};

        const street = [address.addressLine1, address.addressLine2].filter(Boolean).join(' ');
        return {
            orderId: order.orderId || '',
            buyer: shipTo.fullName || order.buyer?.username || '',
            street,
            zip: address.postalCode || '',
            city: address.city || '',
            country: address.countryCode || 'DE',
            item: item.title || '',
            quantity: item.quantity || 1,
            total: order.pricingSummary?.total?.value
                ? `${order.pricingSummary.total.value} ${order.pricingSummary.total.currency || 'EUR'}`
                : '',
            createdDate: order.creationDate || '',
            status: order.orderFulfillmentStatus || '',
            legacyOrderId: order.legacyOrderId || '',
            source: 'api'
        };
    }

    async function syncOrders(options = {}) {
        const orders = await fetchOrders(options);
        const mapped = orders.map(mapOrder).filter((o) => o.orderId);
        await chrome.storage.local.set({
            [KEYS.orders]: mapped,
            [KEYS.config]: await getConfig()
        });
        return mapped;
    }

    async function getCachedOrders() {
        const result = await chrome.storage.local.get(KEYS.orders);
        return Array.isArray(result[KEYS.orders]) ? result[KEYS.orders] : [];
    }

    /**
     * Status für die Optionsseite – ohne Secrets.
     */
    async function status() {
        const config = await getConfig();
        const tokens = await getTokens();
        return {
            configured: Boolean(config?.clientId && config?.clientSecret && config?.ruName),
            clientId: config?.clientId ? `${config.clientId.slice(0, 8)}…` : '',
            ruName: config?.ruName || '',
            env: config?.env || 'production',
            connected: Boolean(tokens.refreshToken),
            accessTokenValid: Boolean(tokens.accessToken && tokens.expiresAt && Date.now() < tokens.expiresAt),
            redirectUrl: redirectUrl(),
            scope: SCOPES[0]
        };
    }

    return {
        ENVIRONMENTS,
        SCOPES,
        KEYS,
        getConfig,
        saveConfig,
        getTokens,
        saveTokens,
        clearTokens,
        clearAll,
        redirectUrl,
        buildAuthorizeUrl,
        authorize,
        exchangeCode,
        refreshAccessToken,
        ensureAccessToken,
        fetchOrders,
        mapOrder,
        syncOrders,
        getCachedOrders,
        status
    };
})();

if (typeof window !== 'undefined') window.sendPilotEbay = EBAY;
if (typeof module !== 'undefined' && module.exports) module.exports = EBAY;
