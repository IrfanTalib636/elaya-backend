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
    DEFAULT_OEFFNUNGSZEITEN,
    MITARBEITER_ROLLEN,
    mergeOeffnungszeiten,
};
