/** Normalize mobile/API lang (`en`, `en-US`, `de-CH`) → `de` | `en` | null. */
const normalizePreferredLang = (raw) => {
    if (raw == null) return null;
    const base = String(raw).trim().toLowerCase().split(/[-_]/)[0];
    if (base === 'en' || base === 'de') return base;
    return null;
};

module.exports = { normalizePreferredLang };
