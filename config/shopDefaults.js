/** ElayShop defaults — provision, shipping, categories (prototype parity). */

/** Studio commission share of merchandise (warenwert). Client model: 20% studio / 80% Elaya. */
const DEFAULT_SHOP_PROVISION_PROZENT = 20;

const SHOP_CATEGORIES = [
    'Nachsorge',
    'Sonnenschutz',
    'Reinigung',
    'Zubehör',
    'Sonstiges',
];

const SHOP_COUNTRIES = [
    'Schweiz',
    'Deutschland',
    'Österreich',
    'Frankreich',
    'Italien',
    'Andere EU',
];

/** Shipping rates CHF by country + free-shipping thresholds (prototype). */
const DEFAULT_SHOP_SHIPPING = {
    Schweiz: 6.9,
    Deutschland: 12.9,
    Österreich: 12.9,
    Frankreich: 14.9,
    Italien: 14.9,
    'Andere EU': 16.9,
    gratis_ab_ch: 75,
    gratis_ab_eu: 150,
};

const DEFAULT_SHOP_PRODUCTS = [
    {
        product_code: 'prod_001',
        artikelnummer: 'ELY-001',
        name: 'Elaya Nachsorge-Gel',
        beschreibung:
            'Beruhigendes Gel für optimale Heilung nach der Laserbehandlung. Dermatologisch getestet, parfümfrei.',
        preis_chf: 24.9,
        kategorie: 'Nachsorge',
        ean: '7612345678901',
        ursprung: 'Schweiz',
        lagerbestand: null,
        aktiv: true,
        sort_order: 1,
    },
    {
        product_code: 'prod_002',
        artikelnummer: 'ELY-002',
        name: 'Elaya Sun Protect SPF 50+',
        beschreibung:
            'Hochschützende Sonnencreme speziell für behandelte Haut. Wasserfest, leichte Textur.',
        preis_chf: 32.5,
        kategorie: 'Sonnenschutz',
        ean: '7612345678902',
        ursprung: 'Deutschland',
        lagerbestand: null,
        aktiv: true,
        sort_order: 2,
    },
    {
        product_code: 'prod_003',
        artikelnummer: 'ELY-003',
        name: 'Elaya Repair Serum',
        beschreibung:
            'Intensiv-Serum mit Hyaluronsäure und Panthenol. Unterstützt die Hautregeneration nach der Behandlung.',
        preis_chf: 48.0,
        kategorie: 'Nachsorge',
        ean: '7612345678903',
        ursprung: 'Schweiz',
        lagerbestand: null,
        aktiv: true,
        sort_order: 3,
    },
    {
        product_code: 'prod_004',
        artikelnummer: 'ELY-004',
        name: 'Elaya Cleansing Foam',
        beschreibung:
            'Sanfter Reinigungsschaum für empfindliche und behandelte Haut. pH-neutral, alkoholfrei.',
        preis_chf: 19.9,
        kategorie: 'Reinigung',
        ean: '7612345678904',
        ursprung: 'Österreich',
        lagerbestand: null,
        aktiv: true,
        sort_order: 4,
    },
    {
        product_code: 'prod_005',
        artikelnummer: 'ELY-005',
        name: 'Elaya Recovery Kit',
        beschreibung:
            'Komplettset für die optimale Nachsorge: Gel, Sonnenschutz und Reinigungsschaum im praktischen Set.',
        preis_chf: 69.0,
        kategorie: 'Nachsorge',
        ean: '7612345678905',
        ursprung: 'Schweiz',
        lagerbestand: null,
        aktiv: true,
        sort_order: 5,
    },
];

/**
 * Compute shipping for a country given merchandise total (warenwert).
 * @returns {{ versandkosten: number, gratis: boolean }}
 */
const calculateShipping = (land, warenwert, shippingConfig = DEFAULT_SHOP_SHIPPING) => {
    const country = SHOP_COUNTRIES.includes(land) ? land : 'Andere EU';
    const base = shippingConfig[country] ?? shippingConfig['Andere EU'] ?? 16.9;
    const isCh = country === 'Schweiz';
    const threshold = isCh ? shippingConfig.gratis_ab_ch : shippingConfig.gratis_ab_eu;
    const gratis = warenwert >= threshold;
    return {
        versandkosten: gratis ? 0 : base,
        gratis,
        land: country,
    };
};

module.exports = {
    DEFAULT_SHOP_PROVISION_PROZENT,
    SHOP_CATEGORIES,
    SHOP_COUNTRIES,
    DEFAULT_SHOP_SHIPPING,
    DEFAULT_SHOP_PRODUCTS,
    calculateShipping,
};
