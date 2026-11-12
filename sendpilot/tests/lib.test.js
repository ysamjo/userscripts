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

// --- eBay-Übergabe ---

check('Adressblock: Name, Straße, PLZ Ort, Land', () => {
    const block = lib.ebayAddressBlock({ buyer: 'Max Muster', street: 'Hauptstr. 1', zip: '12345', city: 'Berlin', country: 'DE' });
    assert.strictEqual(block, 'Max Muster\nHauptstr. 1\n12345 Berlin\nDeutschland');
});

check('Adressblock: Ausland bleibt Ausland', () => {
    const block = lib.ebayAddressBlock({ buyer: 'A', street: 'B', zip: '1010', city: 'Wien', country: 'AT' });
    assert.strictEqual(block.split('\n').pop(), 'AT');
});

check('Adressblock: leere Eingabe bleibt leer', () => {
    assert.strictEqual(lib.ebayAddressBlock(null), '');
    assert.strictEqual(lib.ebayAddressBlock({}), '');
});

check('Hermes-CSV-Zeile hat 6 Semikolon-Felder', () => {
    const row = lib.ebayCsvRow({ buyer: 'Max', street: 'Hauptstr. 1', zip: '12345', city: 'Berlin', country: 'DE', weight: 5 });
    assert.strictEqual(row.split(';').length, 6);
    assert.ok(row.startsWith('Max;Hauptstr. 1;12345;Berlin;DE;5'));
    assert.strictEqual(lib.EBAY_CSV_HEADER.split(';').length, 6);
});

check('CSV maskiert Semikolon im Namen', () => {
    const row = lib.ebayCsvRow({ buyer: 'Muster; GmbH', street: 'Weg 2', zip: '1', city: 'X' });
    assert.strictEqual(row.split(';').length, 6);
});

check('eBay-Import-Support verweist auf echte Konto-Seiten', () => {
    assert.ok(lib.EBAY_IMPORT_SUPPORT.kns.url.includes('/portal/ebayimport'));
    assert.ok(lib.EBAY_IMPORT_SUPPORT.hermes.url.includes('/meinkonto/ebayimport'));
});

check('orderToPackage nutzt Fallback-Maße', () => {
    const pkg = lib.orderToPackage({ weight: 2.5 }, { laenge: 60, breite: 40, hoehe: 30, gewicht: 5 });
    assert.strictEqual(pkg.gewicht, 2.5);
    assert.strictEqual(pkg.laenge, 60);
});

process.on('exit', () => console.log(`\n${passed} Tests bestanden.`));

// --- eBay-API-Modul (pure Funktionen, kein chrome/fetch) ---
const ebayApi = require('../popup/ebay-api.js');

check('EBAY-URL: redirect_uri ist der RuName (nicht die URL)', () => {
    const url = ebayApi.buildAuthorizeUrl({ clientId: 'CID', ruName: 'App-SendPilot-PRD-abc' }, 'st');
    assert.ok(url.startsWith('https://auth.ebay.com/oauth2/authorize?'), url);
    assert.ok(url.includes('redirect_uri=App-SendPilot-PRD-abc'));
    assert.ok(!url.includes('redirect_uri=https%3A%2F%2F'));
    assert.ok(url.includes('scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.fulfillment.readonly'));
});

check('EBAY-URL: Sandbox nutzt auth.sandbox.ebay.com', () => {
    const url = ebayApi.buildAuthorizeUrl({ clientId: 'C', ruName: 'R', env: 'sandbox' }, 'st');
    assert.ok(url.startsWith('https://auth.sandbox.ebay.com/'));
});

check('EBAY-mapOrder: minimale Bestellung wirft nicht', () => {
    const order = ebayApi.mapOrder({});
    assert.strictEqual(order.orderId, '');
    assert.strictEqual(order.country, 'DE');
});

check('EBAY-mapOrder: Adresse/Buyer korrekt zusammengesetzt', () => {
    const order = ebayApi.mapOrder({
        orderId: '123!456',
        buyer: { username: 'knd1' },
        fulfillmentStartInstructions: [{
            shippingStep: {
                shipTo: {
                    fullName: 'Max Mustermann',
                    contactAddress: {
                        addressLine1: 'Hauptstr. 1',
                        addressLine2: 'EG',
                        postalCode: '12345',
                        city: 'Berlin',
                        countryCode: 'DE'
                    }
                }
            }
        }],
        lineItems: [{ title: 'Buch', quantity: 2 }],
        pricingSummary: { total: { value: '19.99', currency: 'EUR' } },
        orderFulfillmentStatus: 'IN_PROGRESS'
    });
    assert.strictEqual(order.buyer, 'Max Mustermann');
    assert.strictEqual(order.street, 'Hauptstr. 1 EG');
    assert.strictEqual(order.zip, '12345');
    assert.strictEqual(order.city, 'Berlin');
    assert.strictEqual(order.item, 'Buch');
    assert.strictEqual(order.total, '19.99 EUR');
});
