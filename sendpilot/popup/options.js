/* SendPilot – Options-Seite (Einstellungen + Live-Rechner) */

const {
    sortedDims,
    girthCm,
    volumetricWeightKg,
    chargeableWeightKg,
    buildUrl,
    letterTier,
    formatKg
} = window.sendPilotLib;

const SETTINGS_KEY = 'sendpilot.settings';
const HISTORY_KEY = 'sendpilot.history';
const DRAFT_KEY = 'sendpilot.draft';

const DEFAULTS = {
    quickProvider: 'paketda',
    clickOpensPaketda: false,
    country: 'DE',
    divisor: 5000
};

const $ = (sel) => document.querySelector(sel);

let settings = Object.assign({}, DEFAULTS);

function euro(value) {
    return `${value.toFixed(2).replace('.', ',')} €`;
}

function dpdClass(pkg) {
    const [l, , h] = sortedDims(pkg);
    if (!l || !h) return '–';
    const metric = l + h;
    if (metric <= 35) return 'XS (bis 35 cm)';
    if (metric <= 50) return 'S (bis 50 cm)';
    if (metric <= 70) return 'M (bis 70 cm)';
    if (metric <= 90) return 'L (bis 90 cm)';
    return 'XL (über 90 cm)';
}

function knsPossible(pkg) {
    const [l, b, h] = sortedDims(pkg);
    const girth = girthCm(pkg);
    const weight = Number(pkg.gewicht) || 0;
    if (!l || !b || !h || !weight) return '–';
    const fits = weight <= 10 && l <= 200 && b <= 80 && h <= 60 && girth <= 300;
    return fits ? 'ja' : 'nein';
}

function readCalc() {
    const pkg = {};
    ['laenge', 'breite', 'hoehe', 'gewicht'].forEach((field) => {
        const raw = $(`#c_${field}`)?.value?.trim().replace(',', '.');
        pkg[field] = raw ? Number.parseFloat(raw) : NaN;
    });
    return pkg;
}

function updateCalc() {
    const pkg = readCalc();
    const [l, b, h] = sortedDims(pkg);
    const girth = girthCm(pkg);
    const letter = letterTier(pkg);

    $('#c-dims').textContent = l && b && h ? `${l} × ${b} × ${h} cm` : '–';
    $('#c-girth').textContent = girth ? `${girth.toFixed(0)} cm` : '–';
    $('#c-vol').textContent = formatKg(volumetricWeightKg(pkg, 5000));
    $('#c-charge-5000').textContent = formatKg(chargeableWeightKg(pkg, 'dhl'));
    $('#c-charge-6000').textContent = formatKg(chargeableWeightKg(pkg, 'dpd'));
    $('#c-letter').textContent = letter ? `${letter.name} (${euro(letter.price)})` : 'kein Brief';
    $('#c-dpd').textContent = dpdClass(pkg);
    $('#c-kns').textContent = knsPossible(pkg);

    const targets = $('#calc-targets');
    targets.innerHTML = '';
    if (!l || !b || !h) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'Maße eingeben, um Direktlinks zu sehen.';
        targets.appendChild(hint);
        return;
    }

    ['paketda', 'kns', 'packlink', 'dhl'].forEach((provider) => {
        const a = document.createElement('a');
        a.href = buildUrl(provider, pkg, settings.country);
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'target-link';
        a.textContent = `Mit diesen Maßen öffnen: ${provider}`;
        targets.appendChild(a);
    });
}

async function loadSettings() {
    const sync = await chrome.storage.sync.get(SETTINGS_KEY);
    settings = Object.assign({}, DEFAULTS, sync[SETTINGS_KEY] || {});
    $('#quick-provider').value = settings.quickProvider;
    $('#country').value = settings.country;
    $('#divisor').value = String(settings.divisor);
    $('#click-paketda').checked = Boolean(settings.clickOpensPaketda);
}

async function saveSettings() {
    settings = {
        quickProvider: $('#quick-provider').value,
        country: $('#country').value,
        divisor: Number($('#divisor').value),
        clickOpensPaketda: $('#click-paketda').checked
    };
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    const status = document.createElement('span');
    status.textContent = ' gespeichert';
    status.className = 'saved-flash';
    document.body.appendChild(status);
    setTimeout(() => status.remove(), 1200);
    updateCalc();
}

async function renderUsage() {
    const local = await chrome.storage.local.get([HISTORY_KEY, DRAFT_KEY]);
    const history = Array.isArray(local[HISTORY_KEY]) ? local[HISTORY_KEY] : [];
    const draft = local[DRAFT_KEY];

    const box = $('#usage');
    box.innerHTML = '';

    const rows = [
        ['Gespeicherte Pakete', String(history.length)],
        ['Letztes Paket', history[0]
            ? `${sortedDims(history[0].pkg).join(' × ')} cm · ${Number(history[0].pkg.gewicht).toString().replace('.', ',')} kg`
            : '–'],
        ['Letzte Aktion', history[0]?.provider || '–'],
        ['Entwurf im Popup', draft?.pkg
            ? `${sortedDims(draft.pkg).join(' × ')} cm`
            : '–']
    ];

    rows.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'usage-row';
        row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
        box.appendChild(row);
    });
}

function bind() {
    ['quick-provider', 'country', 'divisor', 'click-paketda'].forEach((id) => {
        $(`#${id}`).addEventListener('change', saveSettings);
    });

    ['laenge', 'breite', 'hoehe', 'gewicht'].forEach((field) => {
        const input = $(`#c_${field}`);
        input.addEventListener('input', updateCalc);
    });

    $('#clear-history').addEventListener('click', async () => {
        await chrome.storage.local.remove([HISTORY_KEY, DRAFT_KEY]);
        await renderUsage();
    });

    $('#export-settings').addEventListener('click', async () => {
        const local = await chrome.storage.local.get(HISTORY_KEY);
        const payload = {
            settings,
            history: local[HISTORY_KEY] || []
        };
        const out = $('#export-out');
        out.hidden = false;
        out.textContent = JSON.stringify(payload, null, 2);
        try {
            await navigator.clipboard.writeText(out.textContent);
        } catch (e) {}
    });
}

async function startOptions() {
    if (!$('#quick-provider')) return;
    $('#version').textContent = `v${chrome.runtime.getManifest().version}`;
    bind();
    await loadSettings();
    updateCalc();
    await renderUsage();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startOptions, { once: true });
} else {
    // Skript wird nach dem Parsen injiziert (Test/Nachladen)
    setTimeout(startOptions, 0);
}
