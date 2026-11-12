/* SendPilot – Popup-Logik
 *
 * Kein Inline-JS (MV3-CSP): alle Handler werden hier gebunden.
 * Alles, was zwingend doppelt existiert (Service Worker), ist als Spiegel markiert.
 */

// --- Gemeinsame Logik aus lib.js -------------------------------------------

const {
    sortedDims,
    girthCm,
    volumetricWeightKg,
    chargeableWeightKg,
    missingFields,
    urlParams,
    buildUrl,
    letterTier,
    formatKg
} = window.sendPilotLib;

// --- Paketdienste (Anzeige) -------------------------------------------------

const COURIERS = [
    { id: 'paketda', name: 'Paketda', desc: 'Preisvergleich, Maße werden eingetragen', color: '#1e64c8', limit: 'bis 31,5 kg' },
    { id: 'kns', name: 'Klick-n-Schick', desc: 'DPD-Paketschein, Maße automatisch', color: '#10b981', limit: 'bis 10 kg' },
    { id: 'packlink', name: 'Packlink', desc: 'DPD/Hermes-Vergleich', color: '#0052cc', limit: 'bis 20 kg' },
    { id: 'dhl', name: 'DHL Online-Porto', desc: 'Online-Frankierung', color: '#c8102e', limit: 'bis 31,5 kg' },
    { id: 'hermes', name: 'Hermes', desc: 'Paket bis 25 kg', color: '#0a8fc4', limit: 'bis 25 kg' },
    { id: 'dpd', name: 'DPD', desc: 'Paket bis 31,5 kg', color: '#dc0032', limit: 'bis 31,5 kg' },
    { id: 'gls', name: 'GLS', desc: 'Business & Privat', color: '#ffcc00', limit: 'bis 40 kg' },
    { id: 'ups', name: 'UPS', desc: 'Maße werden mitgegeben', color: '#5b3a1e', limit: 'bis 70 kg' },
    { id: 'post', name: 'Deutsche Post (Brief)', desc: 'Briefmaße prüfen', color: '#ffcc00', limit: 'bis 1 kg' }
];

// --- Zustand ----------------------------------------------------------------

const FIELDS = ['laenge', 'breite', 'hoehe', 'gewicht'];
const STORAGE_DRAFT = 'sendpilot.draft';
const STORAGE_SETTINGS = 'sendpilot.settings';
const HISTORY_KEY = 'sendpilot.history';

let settings = { quickProvider: 'paketda', clickOpensPaketda: false, country: 'DE', divisor: 5000 };
let currentPkg = null;

const $ = (selector) => document.querySelector(selector);

function readForm() {
    const pkg = {};
    FIELDS.forEach((field) => {
        const raw = $(`#f_${field}`)?.value?.trim().replace(',', '.');
        pkg[field] = raw ? Number.parseFloat(raw) : NaN;
    });
    return pkg;
}

function writeForm(pkg) {
    FIELDS.forEach((field) => {
        const el = $(`#f_${field}`);
        if (!el) return;
        const value = Number(pkg?.[field]);
        el.value = Number.isFinite(value) && value > 0 ? String(value).replace('.', ',') : '';
    });
}

// --- Anzeige ----------------------------------------------------------------

function renderStats(pkg) {
    const [l, b, h] = sortedDims(pkg);
    const girth = girthCm(pkg);
    const vol = volumetricWeightKg(pkg, settings.divisor || 5000);
    const chargeable = chargeableWeightKg(pkg, settings.quickProvider);

    $('#stat-girth').textContent = girth ? `${girth.toFixed(0)} cm` : '–';
    $('#stat-vol').textContent = formatKg(vol);
    $('#stat-charge').textContent = formatKg(chargeable);
    $('#stat-dims').textContent = l && b && h ? `${l} × ${b} × ${h} cm` : '–';

    // Gurtmaß-Ampel (DPD: 300 cm, DHL: 360 cm)
    const girthEl = $('#stat-girth');
    girthEl.classList.remove('warn', 'bad');
    if (girth) {
        if (girth > 360) girthEl.classList.add('bad');
        else if (girth > 300) girthEl.classList.add('warn');
    }

    const warnBox = $('#warnings');
    warnBox.innerHTML = '';
    const warnings = [];
    if (girth && girth > 300) warnings.push('Gurtmaß über 300 cm: DPD und Klick-n-Schick schließen das Paket aus.');
    if (girth && girth > 360) warnings.push('Gurtmaß über 360 cm: nur noch Spedition.');
    if (Number(pkg.gewicht) > 31.5) warnings.push('Über 31,5 kg: DHL/DPD-Paket nicht mehr möglich.');
    if (Number(pkg.gewicht) > 10 && Number(pkg.gewicht) <= 31.5) warnings.push('Über 10 kg: Klick-n-Schick fällt weg.');
    const letter = letterTier(pkg);
    if (letter) warnings.push(`Passt als ${letter.name} (${letter.price.toFixed(2).replace('.', ',')} €).`);

    warnings.forEach((text) => {
        const div = document.createElement('div');
        div.className = 'warning';
        div.textContent = text;
        warnBox.appendChild(div);
    });
}

function renderCouriers(pkg) {
    const grid = $('#couriers');
    grid.innerHTML = '';
    const missing = missingFields(pkg);

    COURIERS.forEach((courier) => {
        const url = buildUrl(courier.id, pkg, settings.country);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'courier';
        btn.dataset.provider = courier.id;
        btn.title = missing.length ? `Ohne Maße: ${courier.desc}` : `${courier.name}: ${courier.desc}`;

        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = courier.color;

        const label = document.createElement('span');
        label.className = 'courier-label';
        label.innerHTML = `<strong>${courier.name}</strong><small>${courier.limit}</small>`;

        btn.append(dot, label);

        if (courier.id === settings.quickProvider) {
            const star = document.createElement('span');
            star.className = 'star';
            star.textContent = '★';
            btn.appendChild(star);
        }

        btn.addEventListener('click', () => openUrl(url, courier.id, pkg));
        grid.appendChild(btn);
    });
}

function renderHistory(history) {
    const list = $('#history');
    list.innerHTML = '';
    if (!history.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Noch keine Pakete gespeichert.';
        list.appendChild(empty);
        return;
    }

    history.forEach((entry) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'history-row';
        const dims = sortedDims(entry.pkg).join(' × ');
        const providerName = entry.provider ? (COURIERS.find((c) => c.id === entry.provider)?.name || entry.provider) : 'gespeichert';
        row.innerHTML = `<span class="hist-dims">${dims} cm</span>`
            + `<span class="hist-meta">${Number(entry.pkg.gewicht).toString().replace('.', ',')} kg · ${providerName}</span>`;
        row.addEventListener('click', () => {
            writeForm(entry.pkg);
            update();
            saveDraft();
        });
        list.appendChild(row);
    });
}

// --- Aktionen ---------------------------------------------------------------

async function openUrl(url, provider, pkg) {
    if (!url) return;
    try {
        await chrome.runtime.sendMessage({ type: 'SENDPILOT_OPEN', url });
        if (pkg && !missingFields(pkg).length) {
            await chrome.runtime.sendMessage({ type: 'SENDPILOT_PACKAGE', package: pkg, provider, country: settings.country });
        }
    } catch (error) {
        console.warn('[SendPilot] openUrl:', error);
    }
    window.close();
}

function update() {
    const pkg = readForm();
    currentPkg = pkg;
    renderStats(pkg);
    renderCouriers(pkg);
}

async function saveDraft() {
    try {
        await chrome.storage.local.set({ [STORAGE_DRAFT]: { pkg: currentPkg, ts: Date.now() } });
    } catch (e) {}
}

async function loadState() {
    const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get(STORAGE_SETTINGS),
        chrome.storage.local.get([STORAGE_DRAFT, HISTORY_KEY])
    ]);
    settings = Object.assign(settings, syncData[STORAGE_SETTINGS] || {});
    const draft = localData[STORAGE_DRAFT];
    if (draft?.pkg) writeForm(draft.pkg);
    renderHistory(Array.isArray(localData[HISTORY_KEY]) ? localData[HISTORY_KEY] : []);
}

// --- Init (nur im Popup) ----------------------------------------------------

if (typeof document !== 'undefined') {
    const startPopup = () => {
        if (!document.getElementById('couriers')) return;
        init();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startPopup, { once: true });
    } else {
        // Skript wird nach dem Parsen injiziert (z. B. im Test oder bei nachgeladenem Popup)
        setTimeout(startPopup, 0);
    }

    function init() {
        // Presets
        document.querySelectorAll('[data-preset]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const [l, b, h, g] = btn.dataset.preset.split('x').map(Number);
                writeForm({ laenge: l, breite: b, hoehe: h, gewicht: g });
                update();
                saveDraft();
                $('#f_laenge')?.focus();
            });
        });

        FIELDS.forEach((field) => {
            const input = $(`#f_${field}`);
            if (!input) return;
            input.addEventListener('input', update);
            input.addEventListener('change', () => {
                update();
                saveDraft();
            });
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const index = FIELDS.indexOf(field);
                const next = FIELDS[index + 1];
                if (next) $(`#f_${next}`)?.focus();
                else openMainProvider();
            });
        });

        $('#main-action').addEventListener('click', openMainProvider);
        $('#open-options').addEventListener('click', (event) => {
            event.preventDefault();
            chrome.runtime.openOptionsPage();
        });
        $('#clear-draft').addEventListener('click', async () => {
            writeForm({});
            update();
            await chrome.storage.local.remove(STORAGE_DRAFT);
        });

        loadState().then(update);

        // Sync: Änderungen aus anderen Tabs / Content-Scripts
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes[HISTORY_KEY]) return;
            renderHistory(Array.isArray(changes[HISTORY_KEY].newValue) ? changes[HISTORY_KEY].newValue : []);
        });
    }

    function openMainProvider() {
        const pkg = readForm();
        const provider = settings.quickProvider || 'paketda';
        openUrl(buildUrl(provider, pkg, settings.country), provider, pkg);
    }
}
