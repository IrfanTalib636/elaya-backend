const WEEKDAY_KEYS = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

const DEFAULT_DAY_HOURS = { offen: true, von: '10:00', bis: '19:00' };

const DEFAULT_OEFFNUNGSZEITEN = {
    mo: { ...DEFAULT_DAY_HOURS },
    di: { ...DEFAULT_DAY_HOURS },
    mi: { ...DEFAULT_DAY_HOURS },
    do: { ...DEFAULT_DAY_HOURS },
    fr: { ...DEFAULT_DAY_HOURS },
    sa: { ...DEFAULT_DAY_HOURS },
    so: { offen: false, von: '10:00', bis: '19:00' },
};

/** Schedule fallbacks used whenever a studio (or location) leaves a field unset. */
const DEFAULT_SLOT_INTERVAL_MINUTEN = 60;
const DEFAULT_PUFFERZEIT_MINUTEN = 10;
/** Slot grid granularity floor — shorter grids make the calendar unusable. */
const MIN_SLOT_INTERVAL_MINUTEN = 15;
const MAX_SLOT_INTERVAL_MINUTEN = 60;
const MAX_PUFFERZEIT_MINUTEN = 120;

const MITARBEITER_ROLLEN = [
    'Studiobetreiber',
    'Laser-Therapeutin',
    'Empfang',
    'Andere',
];

const mergeOeffnungszeiten = (stored = {}) => {
    const merged = {};
    for (const key of WEEKDAY_KEYS) {
        merged[key] = {
            ...DEFAULT_OEFFNUNGSZEITEN[key],
            ...(stored[key] || {}),
        };
    }
    return merged;
};

module.exports = {
    WEEKDAY_KEYS,
    DEFAULT_DAY_HOURS,
    DEFAULT_OEFFNUNGSZEITEN,
    DEFAULT_SLOT_INTERVAL_MINUTEN,
    DEFAULT_PUFFERZEIT_MINUTEN,
    MIN_SLOT_INTERVAL_MINUTEN,
    MAX_SLOT_INTERVAL_MINUTEN,
    MAX_PUFFERZEIT_MINUTEN,
    MITARBEITER_ROLLEN,
    mergeOeffnungszeiten,
};
