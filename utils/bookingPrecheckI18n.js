/**
 * Locale helper for booking precheck strings.
 * Catalogs live in locales/{de,en}/bookingPrecheck.js — no hardcoded UI copy in the engine.
 */
const { normalizePreferredLang } = require('./preferredLanguage');
const de = require('../locales/de/bookingPrecheck');
const en = require('../locales/en/bookingPrecheck');

const CATALOGS = { de, en };

const getPath = (obj, path) => {
    if (!obj || !path) return undefined;
    return String(path)
        .split('.')
        .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
};

const interpolate = (template, vars = {}) => {
    if (template == null) return '';
    return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) =>
        vars[key] == null ? '' : String(vars[key])
    );
};

/** Translate a key for one language (`de` | `en`). Falls back to English, then key. */
const t = (lang, key, vars = {}) => {
    const locale = normalizePreferredLang(lang) || 'de';
    const primary = getPath(CATALOGS[locale], key);
    const fallback = locale === 'en' ? getPath(CATALOGS.de, key) : getPath(CATALOGS.en, key);
    const raw = primary ?? fallback ?? key;
    return interpolate(raw, vars);
};

/** Bilingual message pair for API blocks/warnings. */
const messagePair = (key, vars = {}) => ({
    message_de: t('de', key, vars.de || vars),
    message_en: t('en', key, vars.en || vars),
});

/** Bilingual label pair for option catalogues. */
const labelPair = (key) => ({
    label_de: t('de', key),
    label_en: t('en', key),
});

module.exports = {
    t,
    messagePair,
    labelPair,
    CATALOGS,
};
