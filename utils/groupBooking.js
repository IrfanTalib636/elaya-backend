const { PLATFORM_CONFIG_DEFAULTS, GRUPPEN_PUNKTE } = require('../config/platformDefaults');

const DEFAULT_GRUPPEN = PLATFORM_CONFIG_DEFAULTS.gruppen_groessen || {
    klein_max_cm2: 50,
    mittelgross_max_cm2: 150,
    max_punkte: 4,
    gruppen_rabatt: 0.15,
};

const normalizeGruppenConfig = (raw = {}) => ({
    klein_max_cm2: Number(raw.klein_max_cm2 ?? raw.klein_max_cm2 ?? DEFAULT_GRUPPEN.klein_max_cm2),
    mittelgross_max_cm2: Number(
        raw.mittelgross_max_cm2 ?? raw.mittelgross_max_cm2 ?? DEFAULT_GRUPPEN.mittelgross_max_cm2
    ),
    max_punkte: Number(raw.max_punkte ?? raw.max_punkte ?? DEFAULT_GRUPPEN.max_punkte),
    gruppen_rabatt: Number(raw.gruppen_rabatt ?? raw.gruppen_rabatt ?? DEFAULT_GRUPPEN.gruppen_rabatt),
});

const caseFlaecheCm2 = (caseDoc, zones = []) => {
    if (caseDoc?.zonen_aktiv && Array.isArray(zones) && zones.length) {
        return zones.reduce((sum, zone) => sum + (Number(zone.flaeche_cm2) || 0), 0);
    }
    const explicit = Number.parseFloat(caseDoc?.flaeche_cm2);
    if (explicit > 0) return explicit;
    const length = Number.parseFloat(caseDoc?.tc_size_length) || 0;
    const width = Number.parseFloat(caseDoc?.tc_size_width) || 0;
    if (length > 0 && width > 0) return length * width;
    return 0;
};

const caseGroesse = (caseDoc, zones = [], config = {}) => {
    const cfg = normalizeGruppenConfig({ ...DEFAULT_GRUPPEN, ...config });
    const cm2 = caseFlaecheCm2(caseDoc, zones);
    if (cm2 <= cfg.klein_max_cm2) {
        return { kategorie: 'klein', punkte: GRUPPEN_PUNKTE.klein, cm2 };
    }
    if (cm2 <= cfg.mittelgross_max_cm2) {
        return { kategorie: 'mittelgross', punkte: GRUPPEN_PUNKTE.mittelgross, cm2 };
    }
    return { kategorie: 'gross', punkte: GRUPPEN_PUNKTE.gross, cm2 };
};

const totalPunkte = (items, config) =>
    items.reduce((sum, item) => sum + caseGroesse(item.caseDoc, item.zones, config).punkte, 0);

const validateGroupSelection = (items, config = {}) => {
    const cfg = normalizeGruppenConfig({ ...DEFAULT_GRUPPEN, ...config });
    if (!items || items.length < 2) {
        return { ok: false, message: 'Select at least two cases for a group booking.' };
    }
    const sizes = items.map((item) => caseGroesse(item.caseDoc, item.zones, cfg));
    if (sizes.some((s) => s.kategorie === 'gross') && items.length > 1) {
        return { ok: false, message: 'A large tattoo must be booked alone.' };
    }
    const punkte = sizes.reduce((sum, s) => sum + s.punkte, 0);
    if (punkte > cfg.max_punkte) {
        return { ok: false, message: `Group booking exceeds ${cfg.max_punkte} size points.` };
    }
    return { ok: true, punkte, config: cfg };
};

const round5 = (n) => Math.round(n / 5) * 5;

const calcGroupPricingFromPrices = (prices, config = {}) => {
    const cfg = normalizeGruppenConfig({ ...DEFAULT_GRUPPEN, ...config });
    const zwischensumme = prices.reduce((sum, p) => sum + (Number(p) || 0), 0);
    const rabattPct = cfg.gruppen_rabatt ?? 0.15;
    const gesamt = round5(zwischensumme * (1 - rabattPct));
    return {
        zwischensumme,
        rabatt: zwischensumme - gesamt,
        rabattPct,
        gesamt,
    };
};

module.exports = {
    DEFAULT_GRUPPEN,
    GRUPPEN_PUNKTE,
    normalizeGruppenConfig,
    caseFlaecheCm2,
    caseGroesse,
    totalPunkte,
    validateGroupSelection,
    calcGroupPricingFromPrices,
};
