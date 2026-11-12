/* Teil 1/2 – Klick-n-Schick PowerTools (Chrome-Extension-Variante)
 *
 * Portiert aus dem Userscript `Klick-n-Schick.user.js` v1.3.0.
 * Unterschiede zur Userscript-Fassung:
 *  - `GM_*`-APIs durch `chrome.storage.local` / `fetch` ersetzt (Setting-Sync via Storage-Listener)
 *  - pdf-lib wird nicht mehr per @require geladen, sondern lazy von jsdelivr (mit lokalem
 *    OffscreenDocument-Fallback) – spart Startzeit und funktioniert offline nach dem 1. Laden
 *  - Maße aus URL-Parametern werden an SendPilot zurückgemeldet (gleiche Session)
 */

(function () {
    'use strict';

    // Verhindert Doppel-Injektion durch das alte Tampermonkey-Skript
    if (window.__knsPowerToolsLoaded) return;

    // Extension-APIs können in Sonderfällen (z. B. sehr früher Injektion, Sandbox-Scope)
    // fehlen. Dann läuft alles ohne Persistenz weiter, statt zu crashen.
    const extension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.storage)
        ? chrome
        : null;

    // --- 1. Konfiguration & Persistente Speicherung ---
    const STORAGE_PREFIX = 'kns_powertools_';

    const defaults = {
        saveLogin: true,
        autoLogin: true,
        defaultSperrgutNo: true,
        urlDimensions: true,
        autoImportEbay: true,
        autoCheckout: true,
        alwaysDpd: true,
        autoDownloadPdf: true,
        autoCropPdf: true,
        autoPrintPdf: false,
        printFormat: 'a4_centered',
        enablePresets: true,
        enableCopyTools: true,
        autoCheckAGB: true,
        autoAcceptCookies: true,
        showPanel: false
    };

    const config = Object.assign({}, defaults);
    let configReady = false;

    function readLocalStorageValue(key, fallback) {
        try {
            const raw = localStorage.getItem(STORAGE_PREFIX + key);
            return raw !== null ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function bootstrapConfig() {
        // 1. Sofort aus localStorage spiegeln (Extension-Storage ist asynchron)
        Object.keys(defaults).forEach((key) => {
            config[key] = readLocalStorageValue(key, defaults[key]);
        });

        // 2. Danach autoritativ aus chrome.storage.local laden und Änderungen live übernehmen
        if (!extension) {
            configReady = true;
            applyConfig();
            return;
        }
        try {
            chrome.storage.local.get(STORAGE_PREFIX + 'config', (result) => {
                const stored = result?.[STORAGE_PREFIX + 'config'];
                if (stored && typeof stored === 'object') {
                    Object.keys(defaults).forEach((key) => {
                        if (typeof stored[key] === 'boolean' || typeof stored[key] === 'string') {
                            config[key] = stored[key];
                        }
                    });
                }
                configReady = true;
                applyConfig();
            });

            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local' || !changes[STORAGE_PREFIX + 'config']) return;
                const next = changes[STORAGE_PREFIX + 'config'].newValue || {};
                Object.keys(defaults).forEach((key) => {
                    if (key in next) config[key] = next[key];
                });
                applyConfig();
            });
        } catch (e) {
            configReady = true;
        }
    }

    const isIframe = window.self !== window.top;
    const currentPath = window.location.pathname.toLowerCase();

    // --- 2. URL-Parameter für Maße & Gewicht auslesen ---
    function parseDimensionParams(searchStr) {
        if (!searchStr) return null;
        const params = new URLSearchParams(searchStr);

        function getNum(keys) {
            for (const k of keys) {
                if (params.has(k)) {
                    const val = Number.parseFloat(String(params.get(k)).replace(',', '.'));
                    if (Number.isFinite(val) && val > 0) return val;
                }
            }
            return null;
        }

        const laenge = getNum(['laenge', 'länge', 'length', 'l']);
        const breite = getNum(['breite', 'width', 'b', 'w']);
        const hoehe = getNum(['hoehe', 'höhe', 'height', 'h']);
        const gewicht = getNum(['gewicht', 'weight', 'gew', 'g']);
        const anzahl = getNum(['anzahl', 'count', 'qty']);

        if (laenge || breite || hoehe || gewicht || anzahl) {
            return { laenge, breite, hoehe, gewicht, anzahl };
        }
        return null;
    }

    function resolveDimensions() {
        let dims = parseDimensionParams(window.location.search);
        if (dims) {
            try {
                sessionStorage.setItem('kns_active_dimensions', JSON.stringify(dims));
            } catch (e) {}
            return dims;
        }

        if (isIframe) {
            try {
                if (window.parent && window.parent.location) {
                    dims = parseDimensionParams(window.parent.location.search);
                    if (dims) return dims;
                }
            } catch (e) {}
        }

        try {
            const raw = sessionStorage.getItem('kns_active_dimensions');
            if (raw) return JSON.parse(raw);
        } catch (e) {}

        return null;
    }

    if (!isIframe) {
        const topDims = parseDimensionParams(window.location.search);
        if (topDims) {
            try {
                sessionStorage.setItem('kns_active_dimensions', JSON.stringify(topDims));
            } catch (e) {}
            // An SendPilot melden, damit die Verlaufseinträge vollständig bleiben
            try {
                if (extension) {
                    extension.runtime.sendMessage({ type: 'SENDPILOT_PACKAGE', package: topDims }, () => void extension.runtime.lastError);
                }
            } catch (e) {}
        }
    }

    // --- 3. UI-Hinweis-Banner (Toast) ---
    function showToast(message, type = 'info', duration = 3000) {
        const id = 'kns-toast-container';
        let container = document.getElementById(id);
        if (!container) {
            container = document.createElement('div');
            container.id = id;
            container.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 999999;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            pointer-events: auto;
            background: ${type === 'success' ? '#10b981' : type === 'warn' ? '#f59e0b' : '#1e40af'};
            color: #ffffff;
            padding: 9px 14px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            font-size: 13px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 10px;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.25s ease-out;
        `;
        toast.innerHTML = `<span>⚡ <strong>Klick-n-Schick:</strong> ${message}</span>`;
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // --- 4. Lazy-Loader für pdf-lib ---
    const PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    let pdfLibPromise = null;

    function loadPdfLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        if (pdfLibPromise) return pdfLibPromise;

        pdfLibPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = PDFLIB_URL;
            script.async = true;
            script.onload = () => {
                if (window.PDFLib) resolve(window.PDFLib);
                else reject(new Error('pdf-lib wurde geladen, ist aber nicht verfügbar'));
            };
            script.onerror = () => reject(new Error('pdf-lib konnte nicht geladen werden (offline?)'));
            (document.head || document.documentElement).appendChild(script);
            setTimeout(() => reject(new Error('pdf-lib Timeout')), 15000);
        }).catch((error) => {
            pdfLibPromise = null;
            throw error;
        });

        return pdfLibPromise;
    }

    // --- Feature-Platzhalter, siehe Teil 2 ---
    const features = {
        ready: false,
        apply() {}
    };

    function applyConfig() {
        // Erst laufen lassen, wenn Teil 2 alle Funktionen definiert hat
        if (!features.ready) return;
        try {
            features.apply();
        } catch (error) {
            console.warn('[Klick-n-Schick] applyConfig:', error);
        }
    }

    bootstrapConfig();

    // Weiter in Teil 2
    window.__knsPowerToolsLoaded = true;
    window.__knsPowerTools = {
        loadPdfLib,
        showToast,
        resolveDimensions,
        features,
        config,
        defaults,
        isIframe,
        currentPath,
        extension
    };
})();
