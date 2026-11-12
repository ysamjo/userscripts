/* Selbsttests für popup/lib.js – Aufruf: node tests/lib.test.js */

const assert = require('node:assert');
const lib = require('../popup/lib.js');

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
}

const pkg = { laenge: 60, breite: 40, hoehe: 30, gewicht: 5 };

console.log('SendPilot lib.js');

check('Maße werden absteigend sortiert', () => {
    assert.deepStrictEqual(lib.sortedDims({ laenge: 30, breite: 60, hoehe: 40 }), [60, 40, 30]);
});

check('Ungültige Werte werden ignoriert', () => {
    assert.deepStrictEqual(lib.sortedDims({ laenge: 'abc', breite: 10, hoehe: -5 }), [10]);
});

check('Gurtmaß = L + 2B + 2H', () => {
    assert.strictEqual(lib.girthCm(pkg), 60 + 80 + 60);
});

check('Gurtmaß ist null ohne vollständige Maße', () => {
    assert.strictEqual(lib.girthCm({ laenge: 10 }), null);
});

check('Volumengewicht mit Divisor 5000', () => {
    assert.strictEqual(lib.volumetricWeightKg(pkg, 5000), 14.4);
});

check('Volumengewicht mit Divisor 6000', () => {
    assert.strictEqual(lib.volumetricWeightKg(pkg, 6000), 12);
});

check('Frachtgewicht = Maximum aus real und Volumen', () => {
    assert.strictEqual(lib.chargeableWeightKg(pkg, 'dhl'), 14.4);
    assert.strictEqual(lib.chargeableWeightKg({ laenge: 10, breite: 10, hoehe: 10, gewicht: 5 }, 'dhl'), 5);
});

check('Fehlende Felder werden erkannt', () => {
    assert.deepStrictEqual(lib.missingFields({ laenge: 10, breite: 10 }), ['hoehe', 'gewicht']);
    assert.deepStrictEqual(lib.missingFields(pkg), []);
});

check('URL-Parameter sind sortiert und vollständig', () => {
    const params = lib.urlParams({ laenge: 30, breite: 60, hoehe: 40, gewicht: 5 });
    assert.strictEqual(params.get('laenge'), '60');
    assert.strictEqual(params.get('breite'), '40');
    assert.strictEqual(params.get('hoehe'), '30');
    assert.strictEqual(params.get('gewicht'), '5');
});

check('Paketda-URL enthält Maße und Gewicht', () => {
    const url = new URL(lib.buildUrl('paketda', pkg));
    assert.strictEqual(url.hostname, 'www.paketda.de');
    assert.strictEqual(url.pathname, '/paket-preis-rechner.php');
    assert.strictEqual(url.searchParams.get('laenge'), '60');
    assert.strictEqual(url.searchParams.get('gewicht'), '5');
});

check('Paketda-URL hängt Zielland nur außerhalb DE an', () => {
    assert.strictEqual(new URL(lib.buildUrl('paketda', pkg, 'DE')).searchParams.has('land'), false);
    assert.strictEqual(new URL(lib.buildUrl('paketda', pkg, 'AT')).searchParams.get('land'), 'AT');
});

check('Klick-n-Schick-URL nutzt erwartete Parameter', () => {
    const url = new URL(lib.buildUrl('kns', pkg));
    assert.strictEqual(url.hostname, 'www.klick-n-schick.com');
    assert.strictEqual(url.searchParams.get('laenge'), '60');
    assert.strictEqual(url.searchParams.get('hoehe'), '30');
});

check('Unbekannter Anbieter liefert null', () => {
    assert.strictEqual(lib.buildUrl('gibtsnicht', pkg), null);
});

check('Briefklassifizierung: Maxibrief erkannt', () => {
    const tier = lib.letterTier({ laenge: 30, breite: 20, hoehe: 4, gewicht: 0.8 });
    assert.strictEqual(tier.name, 'Maxibrief');
});

check('Briefklassifizierung: zu dick für Maxibrief', () => {
    assert.strictEqual(lib.letterTier({ laenge: 30, breite: 20, hoehe: 10, gewicht: 0.5 }), null);
});

check('Formatierung nutzt deutsches Dezimalkomma', () => {
    assert.strictEqual(lib.formatKg(14.4), '14,40 kg');
    assert.strictEqual(lib.formatKg(0), '–');
});

console.log(`\n${passed} Tests bestanden.`);
