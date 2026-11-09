// ==UserScript==
// @name         Klick-n-Schick PowerTools
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Erleichtert die Nutzung von Klick-n-Schick: Login speichern & Auto-Login, Sperrgut standardmäßig aktivieren, Maße (Länge, Breite, Höhe, Gewicht) aus URL übernehmen, eBay-Verkäufe automatisch importieren, Warenkorb direkt zur Kasse weiterleiten.
// @author       Andreas Stegmann
// @match        https://www.klick-n-schick.com/portal/*
// @match        https://klick-n-schick.com/portal/*
// @icon         https://www.klick-n-schick.com/portal/favicon.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
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
        alwaysSperrgut: storage.get('cfg_alwaysSperrgut', true),
        urlDimensions: storage.get('cfg_urlDimensions', true),
        autoImportEbay: storage.get('cfg_autoImportEbay', true),
        autoCheckout: storage.get('cfg_autoCheckout', true),
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

    // Maße ermitteln: eigene URL -> Parent URL -> sessionStorage
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

    // Falls auf der Hauptseite Parameter in der URL sind, in sessionStorage sichern
    if (!isIframe) {
        const topDims = parseDimensionParams(window.location.search);
        if (topDims) {
            try {
                sessionStorage.setItem('kns_active_dimensions', JSON.stringify(topDims));
            } catch (e) {}
        }
    }

    // --- 3. UI-Hinweis-Banner ---
    function showToast(message, type = 'info', duration = 3500) {
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
            padding: 10px 16px;
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

    // --- 4. FEATURE 1: Login speichern & Auto-Login ---
    function setupLoginEnhancements() {
        if (!config.saveLogin) return;

        // Finde Benutzername- und Passwort-Felder (sowohl auf Hauptseite als auch im Popup)
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

            // Standard HTML5 Autocomplete-Attribute für Passwort-Manager nachrüsten
            userInput.setAttribute('autocomplete', 'username');
            passInput.setAttribute('autocomplete', 'current-password');
            if (form) form.setAttribute('autocomplete', 'on');

            // Schon initialisiert?
            if (userInput.dataset.knsInitialized === 'true') return;
            userInput.dataset.knsInitialized = 'true';

            // Checkbox "Zugangsdaten merken" hinzufügen
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

            // Gespeicherte Zugangsdaten laden
            const savedCreds = storage.get('login_credentials', null);
            if (savedCreds && savedCreds.username) {
                userInput.value = savedCreds.username;
                if (savedCreds.password) {
                    passInput.value = savedCreds.password;
                }

                // Löschen-Button anzeigen
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

                // Auto-Login, falls gewünscht und auf Popup oder Redirect
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

            // Unter dem Passwort-Feld einbinden
            const parentRow = passInput.closest('tr, li, div');
            if (parentRow && parentRow.parentNode) {
                parentRow.parentNode.insertBefore(container, parentRow.nextSibling);
            } else {
                passInput.after(container);
            }

            // Beim Absenden Zugangsdaten speichern
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

    // --- 5. FEATURE 2: Sperrgut immer anhaken ---
    function setupAlwaysSperrgut() {
        if (!config.alwaysSperrgut) return;

        // 1. Popup-Radiobuttons (#ContentPlaceHolder1_rbSperrgutYes)
        const rbYes = document.querySelector('#ContentPlaceHolder1_rbSperrgutYes');
        const rbNo = document.querySelector('#ContentPlaceHolder1_rbSperrgutNo');
        const hfSperrgut = document.querySelector('#ContentPlaceHolder1_hfSperrgut');

        if (rbYes && !rbYes.checked) {
            rbYes.checked = true;
            if (rbNo) rbNo.checked = false;
            if (hfSperrgut) hfSperrgut.value = 'true';

            // Event für Klick-n-Schick Listener abfeuern
            rbYes.dispatchEvent(new Event('change', { bubbles: true }));

            if (window.$) {
                try {
                    window.$('#ContentPlaceHolder1_rbSperrgutYes').prop('checked', true).trigger('change');
                    window.$('#ContentPlaceHolder1_hfSperrgut').val('true');
                } catch (e) {}
            }
        }

        // 2. Allgemeine Sperrgut-Checkboxes in Tabellen / Zusatzleistungen
        const sperrgutCheckboxes = document.querySelectorAll(`
            input[type="checkbox"][id*="sperrgut" i],
            input[type="checkbox"][name*="sperrgut" i],
            input[type="radio"][value*="sperrgut" i]
        `);
        sperrgutCheckboxes.forEach((cb) => {
            if (!cb.checked && !cb.disabled) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
                cb.dispatchEvent(new Event('click', { bubbles: true }));
            }
        });
    }

    // --- 6. FEATURE 3: Maße aus URL übernehmen ---
    function applyDimensions() {
        if (!config.urlDimensions) return;
        const dims = resolveDimensions();
        if (!dims) return;

        // A) Popup-Felder für Packstücke (addpackstueck.aspx & addpackstueckebay.aspx)
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
            // tryCalc der Seite aufrufen, falls vorhanden (für Gurtmaß-Berechnung)
            if (typeof window.tryCalc === 'function') {
                try {
                    window.tryCalc();
                } catch (e) {}
            }
            // Sperrgut nach Maßeintragung erneut sicherstellen
            setupAlwaysSperrgut();
            showToast(`Maße eingetragen: ${dims.laenge || '?'}×${dims.breite || '?'}×${dims.hoehe || '?'} cm, ${dims.gewicht || '?'} kg`, 'success');
        }

        // B) Tabelle in ebayimport (tr.ebaypakdatarow)
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

    // Beim Klick auf Packstück-Hinzufügen-Links URL-Parameter an Iframe übergeben
    function patchPopupOpenerLinks() {
        const dims = resolveDimensions();
        if (!dims) return;

        const addLinks = document.querySelectorAll('.hlPaketAdd, a.pakadd');
        addLinks.forEach((link) => {
            if (link.dataset.knsPatched === 'true') return;
            link.dataset.knsPatched = 'true';

            link.addEventListener('click', () => {
                // Kurz warten, bis Klick-n-Schick das Iframe erzeugt hat
                setTimeout(() => {
                    const iframe = document.querySelector('.popupcontent iframe');
                    if (iframe && iframe.src && !iframe.src.includes('laenge=')) {
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

    // --- 7. FEATURE 4: eBay automatisch importieren ---
    function setupAutoEbayImport() {
        if (!config.autoImportEbay || isIframe) return;
        if (!currentPath.includes('ebayimport')) return;

        const importBtn = document.querySelector('#ContentPlaceHolder1_btnImport');
        if (!importBtn) return;

        // Endlosschleife verhindern: Nur einmal pro Seitenaufruf / Tab-Sitzung
        const now = Date.now();
        const lastImport = Number.parseInt(sessionStorage.getItem('kns_last_ebay_autoimport') || '0', 10);
        if (now - lastImport < 45000) {
            // Innerhalb der letzten 45s schon ausgeführt
            return;
        }

        sessionStorage.setItem('kns_last_ebay_autoimport', String(now));

        showToast('eBay-Verkäufe werden automatisch importiert...', 'info');

        setTimeout(() => {
            if (importBtn && !importBtn.disabled) {
                importBtn.click();
            }
        }, 600);
    }

    // --- 8. FEATURE 5: Vom Warenkorb automatisch zur Kasse weiterleiten ---
    function setupAutoCheckout() {
        if (!config.autoCheckout || isIframe) return;
        const isCartPage = currentPath.includes('warenkorb') || currentPath.includes('payment.aspx');
        if (!isCartPage) return;

        // Prüfen ob Packstücke im Warenkorb liegen
        const tblPayment = document.querySelector('#ContentPlaceHolder1_tblPayment');
        if (!tblPayment) return;

        const text = tblPayment.innerText || '';
        if (text.includes('Keine Packstücke im Warenkorb')) {
            // Leer -> nichts tun
            return;
        }

        // Befinden wir uns im Warenkorb Step 1?
        const boxStep1 = document.querySelector('#ContentPlaceHolder1_boxStep1');
        if (!boxStep1 || boxStep1.style.display === 'none') {
            return;
        }

        // Button zur Kasse suchen
        // Auf Klick-n-Schick ist das der Submit-Button in ContentPlaceHolder1_buttons1 neben "btnAdd"
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

        // Schutz vor Schleifen: Wenn innerhalb von 15s bereits weitergeleitet wurde
        const now = Date.now();
        const lastCheckout = Number.parseInt(sessionStorage.getItem('kns_last_checkout_redirect') || '0', 10);
        if (now - lastCheckout < 15000) {
            return;
        }

        sessionStorage.setItem('kns_last_checkout_redirect', String(now));

        // Countdown-Banner mit Abbrechen-Option einblenden
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

    // --- 9. Komfort-Funktionen: AGB & Cookies ---
    function setupQualityOfLife() {
        // AGB-Checkbox automatisch anhaken
        if (config.autoCheckAGB) {
            const cbAGB = document.querySelector('#ContentPlaceHolder1_cbAGB');
            if (cbAGB && !cbAGB.checked) {
                cbAGB.checked = true;
                cbAGB.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // Cookie-Banner automatisch akzeptieren
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

    // --- 10. Floating Control Panel (Status & Settings) ---
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

        // Dialog für Einstellungen
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
            width: 320px;
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
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_saveLogin" ${config.saveLogin ? 'checked' : ''}>
                        <span>Login speichern & Auto-Fill</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_alwaysSperrgut" ${config.alwaysSperrgut ? 'checked' : ''}>
                        <span>Sperrgut standardmäßig anhaken</span>
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
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="cfg_autoCheckAGB" ${config.autoCheckAGB ? 'checked' : ''}>
                        <span>AGB & Leitlinien automatisch zustimmen</span>
                    </label>
                </div>
                <div style="margin-top:14px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
                    <button id="kns-clear-creds" style="background:#fee2e2;border:1px solid #f87171;color:#b91c1c;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">
                        Gespeicherte Logins löschen
                    </button>
                    <span style="font-size:11px;color:#9ca3af;">v1.0.0</span>
                </div>
            `;

            modal.querySelector('#kns-modal-close').addEventListener('click', () => {
                modal.style.display = 'none';
            });

            // Checkbox Events binden
            [
                'cfg_saveLogin',
                'cfg_alwaysSperrgut',
                'cfg_urlDimensions',
                'cfg_autoImportEbay',
                'cfg_autoCheckout',
                'cfg_autoCheckAGB'
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

    // --- 11. Initialisierung & MutationObserver ---
    function runAll() {
        setupLoginEnhancements();
        setupAlwaysSperrgut();
        applyDimensions();
        patchPopupOpenerLinks();
        setupAutoEbayImport();
        setupAutoCheckout();
        setupQualityOfLife();
        setupControlPanel();
    }

    // Sofort ausführen
    runAll();

    // Dynamische Nachladungen (ASP.NET UpdatePanels, Popups, jQuery AJAX) beobachten
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
