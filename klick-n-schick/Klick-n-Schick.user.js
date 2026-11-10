// ==UserScript==
// @name         Klick-n-Schick PowerTools
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Erleichtert die Nutzung von Klick-n-Schick: Login speichern & Auto-Login, Sperrgut standardmäßig auf Nein, LEGO-Presets (Mittel, Groß/UCS, Titanic), Maße aus URL übernehmen, eBay-Verkäufe automatisch importieren, immer DPD vorauswählen, Paketscheine automatisch zuschneiden & zentrieren (Keynote-Workflow automatisiert), 1-Klick Drucken & PDF-Export, Adress- & Tracking-Kopierer und Warenkorb direkt zur Kasse leiten.
// @author       Andreas Stegmann
// @match        https://www.klick-n-schick.com/portal/*
// @match        https://klick-n-schick.com/portal/*
// @icon         https://www.klick-n-schick.com/portal/favicon.png
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
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

(function () {
    'use strict';

    // --- 1. Konfiguration & Persistente Speicherung ---
    const STORAGE_PREFIX = 'kns_powertools_';

    const storage = {
        get(key, fallback = null) {
            try {
                if (typeof GM_getValue === 'function') {
                    const val = GM_getValue(key);
                    if (val !== undefined && val !== null) return val;
                }
            } catch (e) {}
            try {
                const raw = localStorage.getItem(STORAGE_PREFIX + key);
                return raw !== null ? JSON.parse(raw) : fallback;
            } catch (e) {
                return fallback;
            }
        },
        set(key, val) {
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(key, val);
                }
            } catch (e) {}
            try {
                localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
            } catch (e) {}
        },
        remove(key) {
            try {
                if (typeof GM_deleteValue === 'function') {
                    GM_deleteValue(key);
                }
            } catch (e) {}
            try {
                localStorage.removeItem(STORAGE_PREFIX + key);
            } catch (e) {}
        }
    };

    const config = {
        saveLogin: storage.get('cfg_saveLogin', true),
        autoLogin: storage.get('cfg_autoLogin', true),
        defaultSperrgutNo: storage.get('cfg_defaultSperrgutNo', true),
        urlDimensions: storage.get('cfg_urlDimensions', true),
        autoImportEbay: storage.get('cfg_autoImportEbay', true),
        autoCheckout: storage.get('cfg_autoCheckout', true),
        alwaysDpd: storage.get('cfg_alwaysDpd', true),
        autoDownloadPdf: storage.get('cfg_autoDownloadPdf', true),
        autoCropPdf: storage.get('cfg_autoCropPdf', true),
        autoPrintPdf: storage.get('cfg_autoPrintPdf', false),
        printFormat: storage.get('cfg_printFormat', 'a4_centered'),
        enablePresets: storage.get('cfg_enablePresets', true),
        enableCopyTools: storage.get('cfg_enableCopyTools', true),
        autoCheckAGB: storage.get('cfg_autoCheckAGB', true),
        autoAcceptCookies: storage.get('cfg_autoAcceptCookies', true)
    };

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

    // --- 4. FEATURE: Login speichern & Auto-Login ---
    function setupLoginEnhancements() {
        if (!config.saveLogin) return;

        const userInputs = document.querySelectorAll(`
            input[name*="txtBenutzername"],
            input[id*="txtBenutzername"],
            input.textloginuser
        `);
        const passInputs = document.querySelectorAll(`
            input[name*="txtPasswort"],
            input[id*="txtPasswort"],
            input.textloginpass
        `);

        if (userInputs.length === 0 || passInputs.length === 0) return;

        userInputs.forEach((userInput, idx) => {
            const passInput = passInputs[idx] || passInputs[0];
            const form = userInput.closest('form');

            userInput.setAttribute('autocomplete', 'username');
            passInput.setAttribute('autocomplete', 'current-password');
            if (form) form.setAttribute('autocomplete', 'on');

            if (userInput.dataset.knsInitialized === 'true') return;
            userInput.dataset.knsInitialized = 'true';

            const container = document.createElement('div');
            container.className = 'kns-login-save-wrapper';
            container.style.cssText = `
                margin: 6px 0 8px 0;
                font-size: 12px;
                color: #2c5282;
                display: flex;
                align-items: center;
                gap: 6px;
                user-select: none;
            `;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `kns_save_cred_${idx}`;
            checkbox.style.cursor = 'pointer';
            checkbox.checked = true;

            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = 'Zugangsdaten merken (Userscript Auto-Fill)';
            label.style.cursor = 'pointer';
            label.style.fontWeight = '600';

            container.appendChild(checkbox);
            container.appendChild(label);

            const savedCreds = storage.get('login_credentials', null);
            if (savedCreds && savedCreds.username) {
                userInput.value = savedCreds.username;
                if (savedCreds.password) {
                    passInput.value = savedCreds.password;
                }

                const deleteLink = document.createElement('a');
                deleteLink.href = '#';
                deleteLink.textContent = '[Löschen]';
                deleteLink.style.cssText = 'color:#e53e3e;text-decoration:underline;margin-left:6px;cursor:pointer;';
                deleteLink.title = 'Gespeicherte Zugangsdaten aus dem Userscript entfernen';
                deleteLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (confirm('Gespeicherte Zugangsdaten wirklich entfernen?')) {
                        storage.remove('login_credentials');
                        userInput.value = '';
                        passInput.value = '';
                        deleteLink.remove();
                        showToast('Zugangsdaten gelöscht', 'warn');
                    }
                });
                container.appendChild(deleteLink);

                if (config.autoLogin && savedCreds.username && savedCreds.password) {
                    const submitBtn = form?.querySelector('input[type="submit"][name*="btnLogin"], input.btncheck, input.btncheckblue');
                    const isLoginPage = currentPath.includes('login') || document.querySelector('#ContentPlaceHolder1_boxPWAendern');
                    const hasAttempted = sessionStorage.getItem('kns_autologin_attempted');

                    if (submitBtn && isLoginPage && !hasAttempted) {
                        sessionStorage.setItem('kns_autologin_attempted', 'true');
                        showToast('Auto-Login in 1 Sekunde...', 'info', 1200);
                        setTimeout(() => {
                            submitBtn.click();
                        }, 800);
                    }
                }
            }

            const parentRow = passInput.closest('tr, li, div');
            if (parentRow && parentRow.parentNode) {
                parentRow.parentNode.insertBefore(container, parentRow.nextSibling);
            } else {
                passInput.after(container);
            }

            const saveHandler = () => {
                if (checkbox.checked && userInput.value.trim() && passInput.value) {
                    storage.set('login_credentials', {
                        username: userInput.value.trim(),
                        password: passInput.value
                    });
                } else if (!checkbox.checked) {
                    storage.remove('login_credentials');
                }
            };

            const submitBtn = form?.querySelector('input[type="submit"][name*="btnLogin"], input.btncheck, input.btncheckblue');
            if (submitBtn) {
                submitBtn.addEventListener('click', saveHandler);
            }
            if (form) {
                form.addEventListener('submit', saveHandler);
            }
        });
    }

    // --- 5. FEATURE: Sperrgut standardmäßig auf NEIN ---
    function setupDefaultSperrgutNo() {
        if (!config.defaultSperrgutNo) return;

        const rbYes = document.querySelector('#ContentPlaceHolder1_rbSperrgutYes');
        const rbNo = document.querySelector('#ContentPlaceHolder1_rbSperrgutNo');
        const hfSperrgut = document.querySelector('#ContentPlaceHolder1_hfSperrgut');

        if (rbNo && !rbNo.checked) {
            rbNo.checked = true;
            if (rbYes) rbYes.checked = false;
            if (hfSperrgut) hfSperrgut.value = 'false';

            rbNo.dispatchEvent(new Event('change', { bubbles: true }));

            if (window.$) {
                try {
                    window.$('#ContentPlaceHolder1_rbSperrgutNo').prop('checked', true).trigger('change');
                    window.$('#ContentPlaceHolder1_hfSperrgut').val('false');
                } catch (e) {}
            }
        }
    }

    // --- 6. POPUP-HÖHE ANPASSEN (Kein Abschneiden mehr!) ---
    function fixPopupHeight() {
        if (!isIframe) return;
        try {
            document.body.style.setProperty('overflow-y', 'auto', 'important');
            document.documentElement.style.setProperty('overflow-y', 'auto', 'important');

            if (window.parent && window.parent.document) {
                const pc = window.parent.document.querySelector('.popupcontent');
                const iframe = window.parent.document.querySelector('.popupcontent iframe');
                if (pc && iframe) {
                    pc.style.setProperty('min-height', '520px', 'important');
                    iframe.style.setProperty('min-height', '520px', 'important');
                    iframe.style.setProperty('height', '520px', 'important');
                }
            }
        } catch (e) {}
    }

    // Auf der Hauptseite Modal-Container für Packstücke vergrößern
    function ensureParentPopupHeight() {
        if (isIframe) return;
        const pc = document.querySelector('.popupcontent');
        const iframe = pc?.querySelector('iframe');
        if (pc && iframe) {
            const src = (iframe.getAttribute('src') || iframe.src || '').toLowerCase();
            if (src.includes('packstueck') || src.includes('addpack') || src === '' || src === 'about:blank') {
                const currentH = Number.parseInt(pc.style.height || iframe.getAttribute('height') || '0', 10);
                if (currentH < 520) {
                    pc.style.setProperty('min-height', '520px', 'important');
                    iframe.style.setProperty('min-height', '520px', 'important');
                    iframe.style.setProperty('height', '520px', 'important');
                }
            }
        }
    }

    // --- 7. FEATURE: 1-Klick Paket-Presets (LEGO RTS Kartons) ---
    function setupPresetsInPopup() {
        if (!config.enablePresets) return;

        const txtLaenge = document.querySelector('#ContentPlaceHolder1_txtpoplaenge, .txtpoplaenge');
        const txtBreite = document.querySelector('#ContentPlaceHolder1_txtpopbreite, .txtpopbreite');
        const txtHoehe = document.querySelector('#ContentPlaceHolder1_txtpophoehe, .txtpophoehe');
        const txtGewicht = document.querySelector('#ContentPlaceHolder1_txtpopgewicht, .txtpopgewicht');

        if (!txtLaenge || !txtBreite || !txtHoehe || document.getElementById('kns-presets-toolbar')) return;

        // Overflow-Sicherung im Iframe
        try {
            document.body.style.overflowY = 'auto';
            document.documentElement.style.overflowY = 'auto';
        } catch (e) {}

        const toolbar = document.createElement('div');
        toolbar.id = 'kns-presets-toolbar';
        toolbar.style.cssText = `
            margin: 4px 0 8px 0;
            padding: 5px 8px;
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 6px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 5px;
            font-size: 11px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        const label = document.createElement('span');
        label.style.cssText = 'font-weight: 700; color: #15803d; margin-right: 2px; white-space: nowrap;';
        label.textContent = '📦 LEGO-Presets:';
        toolbar.appendChild(label);

        // RTS-Kartonmaße wie gewünscht
        const presets = [
            { label: 'Klein (30×20×15 / 1kg)', l: 30, b: 20, h: 15, g: 1.0, title: 'Kleine Sets / Speed Champions' },
            { label: 'Mittel (60×39×10 / 2.5kg)', l: 60, b: 39, h: 10, g: 2.5, title: 'AT-AT 75288 u. ä. (OVP ca. 58,2×37,8×8,7)' },
            { label: 'Groß / UCS (59×49×18 / 5kg)', l: 59, b: 49, h: 18, g: 5.0, title: 'Motorisierter Leuchtturm / Ideas Sets' },
            { label: 'XL / Titanic (60×50×39 / 12kg)', l: 60, b: 50, h: 39, g: 12.0, title: 'Titanic, Millennium Falcon (große RTS)' }
        ];

        presets.forEach((preset) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = preset.label;
            btn.title = preset.title;
            btn.style.cssText = `
                background: #ffffff;
                color: #166534;
                border: 1px solid #86efac;
                padding: 3px 6px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: 600;
                font-size: 11px;
                transition: all 0.15s ease;
                white-space: nowrap;
            `;
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#dcfce7';
                btn.style.borderColor = '#4ade80';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = '#ffffff';
                btn.style.borderColor = '#86efac';
            });
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                txtLaenge.value = String(preset.l);
                txtBreite.value = String(preset.b);
                txtHoehe.value = String(preset.h);
                if (txtGewicht) txtGewicht.value = String(preset.g);

                [txtLaenge, txtBreite, txtHoehe, txtGewicht].forEach((el) => {
                    if (el) {
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('keyup', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new Event('blur', { bubbles: true }));
                    }
                });

                if (typeof window.tryCalc === 'function') {
                    try { window.tryCalc(); } catch (err) {}
                }

                // Sperrgut auf NEIN belassen
                setupDefaultSperrgutNo();
                fixPopupHeight();

                const origText = btn.textContent;
                btn.textContent = '✓ Gesetzt';
                btn.style.background = '#15803d';
                btn.style.color = '#fff';
                setTimeout(() => {
                    btn.textContent = origText;
                    btn.style.background = '#ffffff';
                    btn.style.color = '#166534';
                }, 1000);
            });
            toolbar.appendChild(btn);
        });

        const target = txtLaenge.closest('table') || txtLaenge.closest('div');
        if (target && target.parentNode) {
            target.parentNode.insertBefore(toolbar, target);
        }

        // Direkt nach Einfügen Höhe im Parent nachjustieren
        fixPopupHeight();
        setTimeout(fixPopupHeight, 200);
    }

    // --- 8. FEATURE: Maße aus URL übernehmen ---
    function applyDimensions() {
        if (!config.urlDimensions) return;
        const dims = resolveDimensions();
        if (!dims) return;

        const txtHoehe = document.querySelector('#ContentPlaceHolder1_txtpophoehe, .txtpophoehe');
        const txtBreite = document.querySelector('#ContentPlaceHolder1_txtpopbreite, .txtpopbreite');
        const txtLaenge = document.querySelector('#ContentPlaceHolder1_txtpoplaenge, .txtpoplaenge');
        const txtGewicht = document.querySelector('#ContentPlaceHolder1_txtpopgewicht, .txtpopgewicht');
        const ddlAnzahl = document.querySelector('#ContentPlaceHolder1_ddlAnzahl');

        let filled = false;

        function fillInput(el, val) {
            if (!el || val === null || val === undefined) return;
            const current = el.value ? Number.parseFloat(el.value.replace(',', '.')) : null;
            if (current !== val) {
                el.value = String(val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('keyup', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
                filled = true;
            }
        }

        if (txtHoehe && dims.hoehe) fillInput(txtHoehe, dims.hoehe);
        if (txtBreite && dims.breite) fillInput(txtBreite, dims.breite);
        if (txtLaenge && dims.laenge) fillInput(txtLaenge, dims.laenge);
        if (txtGewicht && dims.gewicht) fillInput(txtGewicht, dims.gewicht);
        if (ddlAnzahl && dims.anzahl) {
            ddlAnzahl.value = String(dims.anzahl);
            ddlAnzahl.dispatchEvent(new Event('change', { bubbles: true }));
            filled = true;
        }

        if (filled) {
            if (typeof window.tryCalc === 'function') {
                try {
                    window.tryCalc();
                } catch (e) {}
            }
            setupDefaultSperrgutNo();
            fixPopupHeight();
            showToast(`Maße eingetragen: ${dims.laenge || '?'}×${dims.breite || '?'}×${dims.hoehe || '?'} cm, ${dims.gewicht || '?'} kg`, 'success');
        }

        const rows = document.querySelectorAll('tr.ebaypakdatarow');
        rows.forEach((row) => {
            const dataid = row.getAttribute('dataid');
            if (!dataid) return;

            const l = document.querySelector(`#laenge_${dataid}`);
            const b = document.querySelector(`#breite_${dataid}`);
            const h = document.querySelector(`#hoehe_${dataid}`);
            const g = document.querySelector(`#gewicht_${dataid}`);

            if (l && dims.laenge && (!l.value || l.value === '0')) fillInput(l, dims.laenge);
            if (b && dims.breite && (!b.value || b.value === '0')) fillInput(b, dims.breite);
            if (h && dims.hoehe && (!h.value || h.value === '0')) fillInput(h, dims.hoehe);
            if (g && dims.gewicht && (!g.value || g.value === '0')) fillInput(g, dims.gewicht);
        });
    }

    function patchPopupOpenerLinks() {
        const dims = resolveDimensions();

        const addLinks = document.querySelectorAll('.hlPaketAdd, a.pakadd');
        addLinks.forEach((link) => {
            if (link.dataset.knsPatched === 'true') return;
            link.dataset.knsPatched = 'true';

            link.addEventListener('click', () => {
                setTimeout(() => {
                    const iframe = document.querySelector('.popupcontent iframe');
                    const pc = document.querySelector('.popupcontent');
                    if (pc && iframe) {
                        pc.style.height = '510px';
                        iframe.style.height = '510px';
                        iframe.setAttribute('height', '510');
                    }
                    if (dims && iframe && iframe.src && !iframe.src.includes('laenge=')) {
                        const url = new URL(iframe.src, window.location.href);
                        if (dims.laenge) url.searchParams.set('laenge', dims.laenge);
                        if (dims.breite) url.searchParams.set('breite', dims.breite);
                        if (dims.hoehe) url.searchParams.set('hoehe', dims.hoehe);
                        if (dims.gewicht) url.searchParams.set('gewicht', dims.gewicht);
                        if (dims.anzahl) url.searchParams.set('anzahl', dims.anzahl);
                        iframe.src = url.toString();
                    }
                }, 50);
            }, true);
        });
    }

    // --- 9. FEATURE: eBay automatisch importieren ---
    function setupAutoEbayImport() {
        if (!config.autoImportEbay || isIframe) return;
        if (!currentPath.includes('ebayimport')) return;

        const importBtn = document.querySelector('#ContentPlaceHolder1_btnImport');
        if (!importBtn) return;

        const now = Date.now();
        const lastImport = Number.parseInt(sessionStorage.getItem('kns_last_ebay_autoimport') || '0', 10);
        if (now - lastImport < 45000) return;

        sessionStorage.setItem('kns_last_ebay_autoimport', String(now));
        showToast('eBay-Verkäufe werden automatisch importiert...', 'info');

        setTimeout(() => {
            if (importBtn && !importBtn.disabled) {
                importBtn.click();
            }
        }, 600);
    }

    // --- 10. FEATURE: Immer DPD als Versanddienstleister vorauswählen ---
    function setupAlwaysDpd() {
        if (!config.alwaysDpd) return;

        const methodContainer = document.querySelector('#ContentPlaceHolder1_divMethoden');
        if (methodContainer) {
            const methodItems = methodContainer.querySelectorAll('div.methodesitem');
            methodItems.forEach((item) => {
                const text = (item.innerText || '').toUpperCase();
                if (text.includes('DPD') && !item.classList.contains('methodesitem_sel')) {
                    const activeMethod = methodContainer.querySelector('div.methodesitem_sel');
                    const activeText = activeMethod ? (activeMethod.innerText || '').toUpperCase() : '';
                    if (!activeText.includes('DPD')) {
                        item.click();
                        showToast('DPD als Versandmethode vorausgewählt', 'info', 1800);
                    }
                }
            });
        }

        const dpdRadios = document.querySelectorAll(`
            input[type="radio"][value*="dpd" i],
            input[type="checkbox"][id*="dpd" i]
        `);
        dpdRadios.forEach((radio) => {
            if (!radio.checked && !radio.disabled) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                radio.dispatchEvent(new Event('click', { bubbles: true }));
            }
        });
    }

    // --- 10.5 FEATURE: Paketschein-Zuschnitt & Druck-Engine (pdf-lib) ---
    async function ensurePdfLib() {
        if (typeof PDFLib !== 'undefined') return PDFLib;
        if (window.PDFLib) return window.PDFLib;
        if (window._pdfLibPromise) return window._pdfLibPromise;

        window._pdfLibPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
            s.onload = () => resolve(window.PDFLib);
            s.onerror = () => {
                const s2 = document.createElement('script');
                s2.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
                s2.onload = () => resolve(window.PDFLib);
                s2.onerror = (err) => reject(new Error('Konnte pdf-lib nicht laden: ' + err));
                document.head.appendChild(s2);
            };
            document.head.appendChild(s);
        });
        return window._pdfLibPromise;
    }

    /**
     * Schneidet den DPD-Paketschein aus dem Klick-n-Schick JasperReports-A4-Bogen aus.
     * Entfernt die Kundenquittung auf der rechten Seite und zentriert das Etikett
     * auf DIN A4 (fuer normales Druckerpapier - Keynote-Workflow)
     * oder liefert ein reines DIN A6 Etikett (fuer Thermodrucker).
     */
    async function processLabelPdf(pdfBytesOrBuffer, mode = 'a4_centered') {
        const pdfLib = await ensurePdfLib();
        const srcDoc = await pdfLib.PDFDocument.load(pdfBytesOrBuffer);
        const outDoc = await pdfLib.PDFDocument.create();
        const pages = srcDoc.getPages();

        for (let i = 0; i < pages.length; i++) {
            const srcPage = pages[i];
            const { width: srcW, height: srcH } = srcPage.getSize();

            // JasperReports LabelBogenA4_A6New Layout:
            // Linker Quadrant = DPD Paketschein
            // Rechter Quadrant = Quittung fuer Kunden
            // In PDF-Koordinaten (Ursprung unten links):
            // Left: 0, Bottom: Math.floor(srcH / 2), Right: Math.ceil(srcW / 2), Top: srcH
            const boundingBox = {
                left: 0,
                bottom: Math.floor(srcH / 2),
                right: Math.ceil(srcW / 2),
                top: srcH
            };

            const embeddedPage = await outDoc.embedPage(srcPage, boundingBox);

            if (mode === 'a6_label') {
                const a6Page = outDoc.addPage([embeddedPage.width, embeddedPage.height]);
                a6Page.drawPage(embeddedPage, { x: 0, y: 0 });
            } else {
                // A4 zentriert (Standard: ersetzt den manuellen Keynote-Schritt komplett!)
                const a4Page = outDoc.addPage([srcW, srcH]);
                const centerX = (srcW - embeddedPage.width) / 2;
                const centerY = (srcH - embeddedPage.height) / 2;
                a4Page.drawPage(embeddedPage, {
                    x: centerX,
                    y: centerY,
                    width: embeddedPage.width,
                    height: embeddedPage.height
                });
            }
        }

        return await outDoc.save();
    }

    async function fetchPdfBuffer(url) {
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'arraybuffer',
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            resolve(res.response);
                        } else {
                            reject(new Error(`HTTP ${res.status} beim Laden des PDFs`));
                        }
                    },
                    onerror: (err) => reject(new Error('Netzwerkfehler beim PDF-Download: ' + err))
                });
            });
        }
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status} beim Laden des PDFs`);
        return await res.arrayBuffer();
    }

    function printPdfBlob(pdfBlob) {
        const blobUrl = URL.createObjectURL(pdfBlob);
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.zIndex = '-9999';
        iframe.src = blobUrl;
        document.body.appendChild(iframe);

        let printed = false;
        const trigger = () => {
            if (printed) return;
            printed = true;
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (e) {
                console.warn('[KnS] Iframe print fallback:', e);
                window.open(blobUrl, '_blank');
            }
            setTimeout(() => {
                iframe.remove();
                URL.revokeObjectURL(blobUrl);
            }, 60000);
        };

        iframe.onload = () => setTimeout(trigger, 300);
        setTimeout(trigger, 1800);
    }

    function downloadPdfBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
        }, 15000);
    }

    async function printLabelDirect(pdfUrl, dataid, mode = 'a4_centered') {
        showToast('🖨️ Paketschein wird vorbereitet (Zentriert)...', 'info', 2500);
        try {
            const rawBytes = await fetchPdfBuffer(pdfUrl);
            const processedBytes = await processLabelPdf(rawBytes, mode);
            const blob = new Blob([processedBytes], { type: 'application/pdf' });
            printPdfBlob(blob);
            showToast('✓ Druckdialog gestartet!', 'success', 2500);
        } catch (err) {
            console.error('[KnS] Print error:', err);
            showToast('Druckfehler: ' + err.message, 'warn', 5000);
        }
    }

    async function downloadLabelProcessed(pdfUrl, dataid, mode = 'a4_centered') {
        const suffix = mode === 'a6_label' ? 'A6' : 'zentriert';
        showToast(`⬇ Paketschein wird vorbereitet (${suffix})...`, 'info', 2500);
        try {
            const rawBytes = await fetchPdfBuffer(pdfUrl);
            const processedBytes = await processLabelPdf(rawBytes, mode);
            const blob = new Blob([processedBytes], { type: 'application/pdf' });
            downloadPdfBlob(blob, `Paketschein_${dataid}_${suffix}.pdf`);
            showToast('✓ Download gestartet!', 'success', 2000);
        } catch (err) {
            console.error('[KnS] Download error:', err);
            showToast('Downloadfehler: ' + err.message, 'warn', 5000);
        }
    }

    function setupShowfileToolbar() {
        if (document.getElementById('kns-pdf-topbar')) return;
        const dataIframe = document.querySelector('iframe[src*="showdata.aspx"]');
        if (!dataIframe || !dataIframe.src) return;

        const url = dataIframe.src;
        const match = url.match(/dataid=(\d+)/i);
        const dataid = match ? match[1] : 'pdf';

        const toolbar = document.createElement('div');
        toolbar.id = 'kns-pdf-topbar';
        toolbar.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 999999;
            background: linear-gradient(135deg, #1e3a8a, #2563eb);
            color: #ffffff;
            padding: 8px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
        `;

        toolbar.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-weight:700;display:flex;align-items:center;gap:6px;">
                    ⚡ Paketschein Power-Tools
                </span>
                <span style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:12px;font-size:11px;">
                    #${dataid}
                </span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="kns-toolbar-print" style="
                    background: #10b981;
                    color: #fff;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: bold;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                ">🖨️ Drucken (Zentriert)</button>
                <button id="kns-toolbar-a4" style="
                    background: #ffffff;
                    color: #1e3a8a;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                ">⬇ A4 Zentriert</button>
                <button id="kns-toolbar-a6" style="
                    background: rgba(255,255,255,0.15);
                    color: #fff;
                    border: 1px solid rgba(255,255,255,0.3);
                    padding: 6px 10px;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                ">🏷️ A6 Label</button>
                <a id="kns-toolbar-orig" href="${url}" target="_blank" download="Paketschein_${dataid}_original.pdf" style="
                    color: #cbd5e1;
                    font-size: 11px;
                    text-decoration: underline;
                    padding-left: 6px;
                ">Original</a>
            </div>
        `;

        document.body.prepend(toolbar);
        document.body.style.paddingTop = '46px';

        toolbar.querySelector('#kns-toolbar-print').addEventListener('click', (e) => {
            e.preventDefault();
            printLabelDirect(url, dataid, 'a4_centered');
        });

        toolbar.querySelector('#kns-toolbar-a4').addEventListener('click', (e) => {
            e.preventDefault();
            downloadLabelProcessed(url, dataid, 'a4_centered');
        });

        toolbar.querySelector('#kns-toolbar-a6').addEventListener('click', (e) => {
            e.preventDefault();
            downloadLabelProcessed(url, dataid, 'a6_label');
        });

        if (config.autoPrintPdf && !sessionStorage.getItem(`kns_autoprinted_${dataid}`)) {
            sessionStorage.setItem(`kns_autoprinted_${dataid}`, 'true');
            setTimeout(() => {
                printLabelDirect(url, dataid, config.printFormat);
            }, 600);
        }
    }

    // --- 11. FEATURE: Paketschein-PDF Auto-Download & Toolbar ---
    function setupAutoPdfDownload() {
        if (currentPath.includes('showfile.aspx') || isIframe) {
            setupShowfileToolbar();
        }

        if (!config.autoDownloadPdf) return;

        if (currentPath.includes('showfile.aspx') || isIframe) {
            const dataIframe = document.querySelector('iframe[src*="showdata.aspx"]');
            if (dataIframe && dataIframe.src) {
                const url = dataIframe.src;
                const match = url.match(/dataid=(\d+)/i);
                const dataid = match ? match[1] : 'pdf';
                if (!sessionStorage.getItem(`kns_autodownloaded_pdf_${dataid}`)) {
                    sessionStorage.setItem(`kns_autodownloaded_pdf_${dataid}`, 'true');
                    if (config.autoCropPdf) {
                        downloadLabelProcessed(url, dataid, config.printFormat);
                    } else {
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Paketschein_${dataid}.pdf`;
                        a.target = '_blank';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                    }
                }
            }
            return;
        }

        const isSuccessPage = currentPath.includes('orderfinish') ||
            currentPath.includes('success') ||
            window.location.search.includes('status=ok') ||
            document.body.innerText.includes('Vielen Dank für Ihre Bestellung') ||
            document.body.innerText.includes('Auftrag erfolgreich erteilt');

        if (isSuccessPage) {
            const pdfLinks = document.querySelectorAll('a.openpdf, a[href*="showdata.aspx"], a[href*="showfile.aspx"], a[href$=".pdf"]');
            pdfLinks.forEach((link) => {
                const dataid = link.getAttribute('dataid') || link.href;
                if (dataid && !sessionStorage.getItem(`kns_autodownloaded_pdf_${dataid}`)) {
                    sessionStorage.setItem(`kns_autodownloaded_pdf_${dataid}`, 'true');
                    if (config.autoCropPdf) {
                        const targetUrl = link.href && link.href.includes('showdata.aspx')
                            ? link.href
                            : `../popups/showdata.aspx?type=pakete&dataid=${dataid}`;
                        downloadLabelProcessed(targetUrl, dataid, config.printFormat);
                    } else {
                        showToast('Neuer Paketschein erstellt: PDF-Download startet...', 'success');
                        link.click();
                    }
                }
            });
        }
    }

    // --- 12. FEATURE: 1-Klick Adress- & Tracking-Kopierer ---
    function setupCopyTools() {
        if (!config.enableCopyTools) return;

        // A) eBay-Käuferadressen auf /portal/ebayimport kopieren
        const ebayAddressSpans = document.querySelectorAll('table.tblebaydata td.datarow span[title*="::"]');
        ebayAddressSpans.forEach((span) => {
            if (span.dataset.knsCopyAdded === 'true') return;
            span.dataset.knsCopyAdded = 'true';

            const rawTitle = span.getAttribute('title') || '';
            const parts = rawTitle.split('::').map((s) => s.trim());
            if (parts.length < 3) return;

            const name = parts[1] || '';
            const street = parts[2] || '';
            const city = parts[3] || '';
            let country = parts[4] || 'Deutschland';
            if (country.toLowerCase() === 'germany' || country.toLowerCase() === 'de') country = 'Deutschland';

            const cleanAddress = [name, street, city, country].filter(Boolean).join('\n');

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.innerHTML = '📋';
            copyBtn.title = `Adresse sauber formatieren & kopieren:\n${cleanAddress}`;
            copyBtn.style.cssText = `
                margin-left: 6px;
                padding: 1px 5px;
                font-size: 11px;
                background: #f1f5f9;
                border: 1px solid #cbd5e1;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.15s ease;
                display: inline-block;
                vertical-align: middle;
            `;

            copyBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(cleanAddress);
                    copyBtn.innerHTML = '✓';
                    copyBtn.style.background = '#dcfce7';
                    copyBtn.style.borderColor = '#86efac';
                    showToast('Käuferadresse in Zwischenablage kopiert!', 'success', 2000);
                    setTimeout(() => {
                        copyBtn.innerHTML = '📋';
                        copyBtn.style.background = '#f1f5f9';
                        copyBtn.style.borderColor = '#cbd5e1';
                    }, 1500);
                } catch (err) {
                    showToast('Kopieren fehlgeschlagen: ' + err.message, 'warn');
                }
            });

            span.after(copyBtn);
        });

        // B) 14-stellige Paket-/Sendungsnummern (DPD) in Tabellen
        const trackingSpans = document.querySelectorAll('td.tdoverflow span[title]');
        trackingSpans.forEach((span) => {
            const text = span.getAttribute('title')?.trim() || '';
            if (!/^\d{14}$/.test(text)) return;
            if (span.dataset.knsTrackingAdded === 'true') return;
            span.dataset.knsTrackingAdded = 'true';

            const trackingNumber = text;
            const container = document.createElement('span');
            container.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; margin-left: 6px;';

            const copyBtn = document.createElement('a');
            copyBtn.href = '#';
            copyBtn.innerHTML = '📋';
            copyBtn.title = `Sendungsnummer ${trackingNumber} kopieren`;
            copyBtn.style.cssText = 'cursor:pointer; text-decoration:none; font-size:12px;';
            copyBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(trackingNumber);
                    showToast(`Tracking #${trackingNumber} kopiert!`, 'success', 2000);
                } catch (err) {
                    showToast('Kopieren fehlgeschlagen', 'warn');
                }
            });

            const dpdLink = document.createElement('a');
            dpdLink.href = `https://tracking.dpd.de/status/de_DE/parcel/${trackingNumber}`;
            dpdLink.target = '_blank';
            dpdLink.rel = 'noopener noreferrer';
            dpdLink.innerHTML = '🔗';
            dpdLink.title = `Live DPD-Sendungsverfolgung für ${trackingNumber} öffnen`;
            dpdLink.style.cssText = 'cursor:pointer; text-decoration:none; font-size:12px;';

            container.append(copyBtn, dpdLink);
            span.after(container);
        });

        // C) Direkter PDF-Download- & Druck-Buttons in meinepaketscheine
        const openPdfLinks = document.querySelectorAll('a.openpdf[dataid]');
        openPdfLinks.forEach((link) => {
            if (link.dataset.knsPdfToolsAdded === 'true') return;
            link.dataset.knsPdfToolsAdded = 'true';

            const dataid = link.getAttribute('dataid');
            if (!dataid) return;

            const pdfUrl = `../popups/showdata.aspx?type=pakete&dataid=${dataid}`;
            const container = document.createElement('span');
            container.className = 'kns-pdf-actions';
            container.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; vertical-align: middle;';

            // 1. Drucken (Zentriert A4)
            const printBtn = document.createElement('button');
            printBtn.type = 'button';
            printBtn.innerHTML = '🖨️ Drucken';
            printBtn.title = 'Paketschein zuschneiden (ohne Quittung), zentrieren & sofort drucken';
            printBtn.style.cssText = `
                background: #059669;
                color: #ffffff;
                border: none;
                border-radius: 4px;
                padding: 2px 7px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                transition: background 0.15s;
            `;
            printBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                printLabelDirect(pdfUrl, dataid, 'a4_centered');
            });

            // 2. A4 Zentriert Download
            const dlA4Btn = document.createElement('button');
            dlA4Btn.type = 'button';
            dlA4Btn.innerHTML = '⬇ A4';
            dlA4Btn.title = 'Paketschein zuschneiden & als zentriertes DIN A4 PDF herunterladen (Keynote-Workflow)';
            dlA4Btn.style.cssText = `
                background: #2563eb;
                color: #ffffff;
                border: none;
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
            `;
            dlA4Btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                downloadLabelProcessed(pdfUrl, dataid, 'a4_centered');
            });

            // 3. A6 Label Download
            const dlA6Btn = document.createElement('button');
            dlA6Btn.type = 'button';
            dlA6Btn.innerHTML = '🏷️ A6';
            dlA6Btn.title = 'Als reines DIN A6 Etikett für Thermodrucker herunterladen';
            dlA6Btn.style.cssText = `
                background: #475569;
                color: #ffffff;
                border: none;
                border-radius: 4px;
                padding: 2px 5px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
            `;
            dlA6Btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                downloadLabelProcessed(pdfUrl, dataid, 'a6_label');
            });

            // 4. Original-Download
            const dlOrigLink = document.createElement('a');
            dlOrigLink.href = pdfUrl;
            dlOrigLink.download = `Paketschein_${dataid}_original.pdf`;
            dlOrigLink.target = '_blank';
            dlOrigLink.innerHTML = 'Orig.';
            dlOrigLink.title = 'Original unbeschnittenes PDF mit Kundenquittung herunterladen';
            dlOrigLink.style.cssText = `
                color: #64748b;
                font-size: 10px;
                text-decoration: underline;
                margin-left: 2px;
            `;

            container.append(printBtn, dlA4Btn, dlA6Btn, dlOrigLink);
            link.after(container);
        });
    }

    // --- 13. FEATURE: Vom Warenkorb automatisch zur Kasse weiterleiten ---
    function setupAutoCheckout() {
        if (!config.autoCheckout || isIframe) return;
        const isCartPage = currentPath.includes('warenkorb') || currentPath.includes('payment.aspx');
        if (!isCartPage) return;

        const tblPayment = document.querySelector('#ContentPlaceHolder1_tblPayment');
        if (!tblPayment) return;

        const text = tblPayment.innerText || '';
        if (text.includes('Keine Packstücke im Warenkorb')) return;

        const boxStep1 = document.querySelector('#ContentPlaceHolder1_boxStep1');
        if (!boxStep1 || boxStep1.style.display === 'none') return;

        const checkoutBtn = document.querySelector(`
            #ContentPlaceHolder1_buttons1 input[type="submit"]:not(#ContentPlaceHolder1_btnAdd):not(#btnAcceptCookies),
            input[type="submit"][value*="Kasse" i],
            input[type="submit"][value*="Weiter" i],
            input[type="submit"][value*="Bezahlen" i],
            input[type="submit"][name*="btnNext" i],
            input[type="submit"][name*="btnPayment" i],
            a.btncheckblue[href*="kasse" i],
            a.btncheckblue[href*="payment" i]
        `);

        if (!checkoutBtn) return;

        const now = Date.now();
        const lastCheckout = Number.parseInt(sessionStorage.getItem('kns_last_checkout_redirect') || '0', 10);
        if (now - lastCheckout < 15000) return;

        sessionStorage.setItem('kns_last_checkout_redirect', String(now));

        let cancelled = false;
        const banner = document.createElement('div');
        banner.style.cssText = `
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            color: #ffffff;
            padding: 12px 18px;
            border-radius: 6px;
            margin: 15px 0;
            box-shadow: 0 4px 10px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 14px;
            font-weight: 500;
        `;
        banner.innerHTML = `
            <span>⚡ <strong>Warenkorb:</strong> Weiterleitung zur Kasse in <b id="kns-countdown">2</b>s...</span>
            <button id="kns-cancel-checkout" style="
                background: rgba(255,255,255,0.2);
                border: 1px solid rgba(255,255,255,0.6);
                color: #fff;
                padding: 4px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: bold;
            ">Abbrechen</button>
        `;

        boxStep1.prepend(banner);

        const cancelBtn = banner.querySelector('#kns-cancel-checkout');
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            cancelled = true;
            banner.innerHTML = '<span>⚡ Weiterleitung abgebrochen.</span>';
            setTimeout(() => banner.remove(), 2500);
        });

        let remaining = 2;
        const interval = setInterval(() => {
            remaining -= 1;
            const cd = document.getElementById('kns-countdown');
            if (cd) cd.textContent = String(remaining);

            if (remaining <= 0) {
                clearInterval(interval);
                if (!cancelled && checkoutBtn) {
                    checkoutBtn.click();
                }
            }
        }, 1000);
    }

    // --- 14. Komfort-Funktionen: AGB & Cookies ---
    function setupQualityOfLife() {
        if (config.autoCheckAGB) {
            const cbAGB = document.querySelector('#ContentPlaceHolder1_cbAGB');
            if (cbAGB && !cbAGB.checked) {
                cbAGB.checked = true;
                cbAGB.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        if (config.autoAcceptCookies) {
            const btnCookiesAll = document.querySelector('#btnCookiesAcceptAll, #btnAcceptCookies');
            if (btnCookiesAll && btnCookiesAll.offsetParent !== null) {
                btnCookiesAll.click();
            }
            const cookieContainer = document.querySelector('#bpscookies, #checkbrowser');
            if (cookieContainer) {
                cookieContainer.style.display = 'none';
            }
        }
    }

    // --- 15. Floating Control Panel (Status & Settings) ---
    function setupControlPanel() {
        if (isIframe || document.getElementById('kns-powertools-panel')) return;

        const button = document.createElement('div');
        button.id = 'kns-powertools-panel';
        button.style.cssText = `
            position: fixed;
            bottom: 16px;
            left: 16px;
            z-index: 999990;
            background: #1e3a8a;
            color: #ffffff;
            padding: 7px 12px;
            border-radius: 20px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            transition: all 0.2s ease-in-out;
            user-select: none;
        `;
        button.innerHTML = '⚡ KNS PowerTools';

        button.addEventListener('mouseenter', () => {
            button.style.transform = 'translateY(-2px)';
            button.style.boxShadow = '0 6px 14px rgba(0,0,0,0.4)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.transform = 'translateY(0)';
            button.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
        });

        const modal = document.createElement('div');
        modal.id = 'kns-powertools-modal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            bottom: 55px;
            left: 16px;
            z-index: 999995;
            background: #ffffff;
            color: #1f2937;
            padding: 16px;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            width: 340px;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            border: 1px solid #e5e7eb;
        `;

        function renderModal() {
            modal.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin-bottom:12px;">
                    <strong style="font-size:14px;color:#1e3a8a;">⚡ KNS PowerTools Einstellungen</strong>
                    <span id="kns-modal-close" style="cursor:pointer;font-weight:bold;color:#6b7280;padding:0 4px;">✕</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:9px;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_defaultSperrgutNo" ${config.defaultSperrgutNo ? 'checked' : ''}>
                        <span><strong>Sperrgut auf 'Nein'</strong> erzwingen</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_alwaysDpd" ${config.alwaysDpd ? 'checked' : ''}>
                        <span><strong>Immer DPD</strong> als Versandart vorauswählen</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_autoDownloadPdf" ${config.autoDownloadPdf ? 'checked' : ''}>
                        <span><strong>Paketschein-PDF</strong> automatisch herunterladen</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_autoCropPdf" ${config.autoCropPdf ? 'checked' : ''}>
                        <span><strong>PDF zuschneiden & zentrieren</strong> (Keynote-Workflow)</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_autoPrintPdf" ${config.autoPrintPdf ? 'checked' : ''}>
                        <span><strong>Sofort-Druckdialog</strong> beim Öffnen starten</span>
                    </label>
                    <div style="display:flex;align-items:center;justify-content:space-between;padding-left:22px;font-size:12px;color:#4b5563;">
                        <span>Standard-Format:</span>
                        <select id="cfg_printFormat" style="padding:2px 6px;border-radius:4px;border:1px solid #cbd5e1;font-size:11px;">
                            <option value="a4_centered" ${config.printFormat === 'a4_centered' ? 'selected' : ''}>A4 zentriert (Standard)</option>
                            <option value="a6_label" ${config.printFormat === 'a6_label' ? 'selected' : ''}>A6 (Thermolabel)</option>
                        </select>
                    </div>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_enablePresets" ${config.enablePresets ? 'checked' : ''}>
                        <span><strong>LEGO-Presets</strong> im Popup anzeigen</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_enableCopyTools" ${config.enableCopyTools ? 'checked' : ''}>
                        <span><strong>1-Klick Adress- & Tracking-Kopierer</strong></span>
                    </label>
                    <hr style="border:0;border-top:1px solid #f3f4f6;margin:4px 0;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_saveLogin" ${config.saveLogin ? 'checked' : ''}>
                        <span>Login speichern & Auto-Fill</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_urlDimensions" ${config.urlDimensions ? 'checked' : ''}>
                        <span>Maße aus URL-Parametern nutzen</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_autoImportEbay" ${config.autoImportEbay ? 'checked' : ''}>
                        <span>eBay automatisch importieren</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_autoCheckout" ${config.autoCheckout ? 'checked' : ''}>
                        <span>Warenkorb direkt zur Kasse leiten</span>
                    </label>
                </div>
                <div style="margin-top:14px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
                    <button id="kns-clear-creds" style="background:#fee2e2;border:1px solid #f87171;color:#b91c1c;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">
                        Gespeicherte Logins löschen
                    </button>
                    <span style="font-size:11px;color:#9ca3af;">v1.3.0</span>
                </div>
            `;

            modal.querySelector('#kns-modal-close').addEventListener('click', () => {
                modal.style.display = 'none';
            });

            [
                'cfg_defaultSperrgutNo',
                'cfg_alwaysDpd',
                'cfg_autoDownloadPdf',
                'cfg_autoCropPdf',
                'cfg_autoPrintPdf',
                'cfg_enablePresets',
                'cfg_enableCopyTools',
                'cfg_saveLogin',
                'cfg_urlDimensions',
                'cfg_autoImportEbay',
                'cfg_autoCheckout'
            ].forEach((key) => {
                const cb = modal.querySelector(`#${key}`);
                if (cb) {
                    cb.addEventListener('change', () => {
                        config[key.replace('cfg_', '')] = cb.checked;
                        storage.set(key, cb.checked);
                        showToast('Einstellung gespeichert', 'info', 1500);
                    });
                }
            });

            const selectFormat = modal.querySelector('#cfg_printFormat');
            if (selectFormat) {
                selectFormat.addEventListener('change', () => {
                    config.printFormat = selectFormat.value;
                    storage.set('cfg_printFormat', selectFormat.value);
                    showToast('Druckformat gespeichert', 'info', 1500);
                });
            }

            modal.querySelector('#kns-clear-creds').addEventListener('click', () => {
                if (confirm('Gespeicherte Login-Daten wirklich löschen?')) {
                    storage.remove('login_credentials');
                    showToast('Login-Daten gelöscht', 'warn');
                }
            });
        }

        button.addEventListener('click', () => {
            if (modal.style.display === 'none' || !modal.style.display) {
                renderModal();
                modal.style.display = 'block';
            } else {
                modal.style.display = 'none';
            }
        });

        document.body.appendChild(button);
        document.body.appendChild(modal);
    }

    // --- 16. Initialisierung & MutationObserver ---
    function runAll() {
        setupLoginEnhancements();
        setupDefaultSperrgutNo();
        setupPresetsInPopup();
        applyDimensions();
        patchPopupOpenerLinks();
        ensureParentPopupHeight();
        setupAutoEbayImport();
        setupAlwaysDpd();
        setupAutoPdfDownload();
        setupCopyTools();
        setupAutoCheckout();
        setupQualityOfLife();
        setupControlPanel();
    }

    runAll();

    let mutationTimer;
    const observer = new MutationObserver(() => {
        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(runAll, 120);
    });

    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });
})();
